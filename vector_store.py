"""
Vector store abstraction for BookGraph.

Chroma remains available for local development. Qdrant is the production-ready
remote option selected with VECTOR_STORE=qdrant.
"""

import os
from pathlib import Path
from typing import Any, Optional
from uuid import NAMESPACE_URL, uuid5

BASE_DIR = Path(__file__).parent
DB_DIR = BASE_DIR / "db"
CHROMA_DIR = DB_DIR / "chroma"

DEFAULT_COLLECTION = "passages"
DEFAULT_VECTOR_SIZE = 1024


def _load_dotenv() -> None:
    env_file = BASE_DIR / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _point_id(passage_id: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"bookgraph:passage:{passage_id}"))


def _filter_from_where(where: Optional[dict[str, Any]]):
    if not where:
        return None
    from qdrant_client import models

    return models.Filter(
        must=[
            models.FieldCondition(key=key, match=models.MatchValue(value=value))
            for key, value in where.items()
        ]
    )


class ChromaVectorStore:
    name = "chroma"

    def __init__(self, collection: str = DEFAULT_COLLECTION):
        import chromadb

        self.client = chromadb.PersistentClient(path=str(CHROMA_DIR))
        self.collection = self.client.get_or_create_collection(
            collection, metadata={"hnsw:space": "cosine"}
        )

    def get(self, *args, **kwargs):
        return self.collection.get(*args, **kwargs)

    def add(self, *args, **kwargs):
        return self.collection.add(*args, **kwargs)

    def delete(self, *args, **kwargs):
        return self.collection.delete(*args, **kwargs)

    def query(self, *args, **kwargs):
        return self.collection.query(*args, **kwargs)


class QdrantVectorStore:
    name = "qdrant"

    def __init__(self, collection: str = DEFAULT_COLLECTION, vector_size: int = DEFAULT_VECTOR_SIZE):
        from qdrant_client import QdrantClient

        _load_dotenv()
        url = os.getenv("QDRANT_URL", "").strip()
        api_key = os.getenv("QDRANT_API_KEY", "").strip()
        if not url:
            raise RuntimeError("QDRANT_URL is required when VECTOR_STORE=qdrant")
        if not api_key:
            raise RuntimeError("QDRANT_API_KEY is required when VECTOR_STORE=qdrant")

        self.collection_name = collection
        self.vector_size = vector_size
        self.client = QdrantClient(url=url, api_key=api_key, timeout=60)
        self._ensure_collection(vector_size)
        self._ensure_payload_indexes()

    def _ensure_collection(self, vector_size: int) -> None:
        from qdrant_client import models

        if self.client.collection_exists(self.collection_name):
            return
        self.client.create_collection(
            collection_name=self.collection_name,
            vectors_config=models.VectorParams(size=vector_size, distance=models.Distance.COSINE),
        )

    def _ensure_payload_indexes(self) -> None:
        from qdrant_client import models

        indexes = {
            "book_id": models.PayloadSchemaType.KEYWORD,
            "book_title": models.PayloadSchemaType.KEYWORD,
            "section_id": models.PayloadSchemaType.KEYWORD,
            "language": models.PayloadSchemaType.KEYWORD,
            "chapter_num": models.PayloadSchemaType.INTEGER,
        }
        for field_name, field_schema in indexes.items():
            try:
                self.client.create_payload_index(
                    collection_name=self.collection_name,
                    field_name=field_name,
                    field_schema=field_schema,
                    wait=True,
                )
            except Exception:
                # Qdrant raises if the index already exists; startup should stay idempotent.
                pass

    def get(self, ids: Optional[list[str]] = None, where: Optional[dict[str, Any]] = None, include: Optional[list[str]] = None):
        if ids:
            points = self.client.retrieve(
                collection_name=self.collection_name,
                ids=[_point_id(pid) for pid in ids],
                with_payload=True,
                with_vectors=False,
            )
        else:
            points = []
            next_page = None
            query_filter = _filter_from_where(where)
            while True:
                batch, next_page = self.client.scroll(
                    collection_name=self.collection_name,
                    scroll_filter=query_filter,
                    limit=1000,
                    offset=next_page,
                    with_payload=True,
                    with_vectors=False,
                )
                points.extend(batch)
                if next_page is None:
                    break

        out = {"ids": [], "metadatas": [], "documents": []}
        include = include or []
        for point in points:
            payload = point.payload or {}
            out["ids"].append(payload.get("passage_id") or str(point.id))
            metadata = {k: v for k, v in payload.items() if k not in {"document", "passage_id"}}
            out["metadatas"].append(metadata)
            if "documents" in include:
                out["documents"].append(payload.get("document", ""))
        return out

    def add(self, ids: list[str], embeddings: list[list[float]], documents: list[str], metadatas: list[dict[str, Any]]):
        from qdrant_client import models

        if embeddings:
            self._ensure_collection(len(embeddings[0]))
        points = [
            models.PointStruct(
                id=_point_id(pid),
                vector=embedding,
                payload={**metadata, "document": document, "passage_id": pid},
            )
            for pid, embedding, document, metadata in zip(ids, embeddings, documents, metadatas)
        ]
        self.client.upsert(collection_name=self.collection_name, points=points, wait=True)

    def delete(self, ids: Optional[list[str]] = None, where: Optional[dict[str, Any]] = None):
        from qdrant_client import models

        selector: models.PointIdsList | models.FilterSelector
        if ids:
            selector = models.PointIdsList(points=[_point_id(pid) for pid in ids])
        else:
            selector = models.FilterSelector(filter=_filter_from_where(where))
        self.client.delete(collection_name=self.collection_name, points_selector=selector, wait=True)

    def query(
        self,
        query_embeddings: list[list[float]],
        n_results: int,
        where: Optional[dict[str, Any]] = None,
        include: Optional[list[str]] = None,
    ):
        include = include or []
        documents, metadatas, distances = [], [], []
        query_filter = _filter_from_where(where)

        for embedding in query_embeddings:
            if hasattr(self.client, "search"):
                points = self.client.search(
                    collection_name=self.collection_name,
                    query_vector=embedding,
                    query_filter=query_filter,
                    limit=n_results,
                    with_payload=True,
                    with_vectors=False,
                )
            else:
                response = self.client.query_points(
                    collection_name=self.collection_name,
                    query=embedding,
                    query_filter=query_filter,
                    limit=n_results,
                    with_payload=True,
                    with_vectors=False,
                )
                points = response.points
            row_docs, row_metas, row_distances = [], [], []
            for point in points:
                payload = point.payload or {}
                row_docs.append(payload.get("document", ""))
                row_metas.append({k: v for k, v in payload.items() if k not in {"document", "passage_id"}})
                # Chroma cosine distance is lower-is-better; Qdrant cosine score is higher-is-better.
                row_distances.append(max(0.0, 1.0 - float(point.score)))
            documents.append(row_docs)
            metadatas.append(row_metas)
            distances.append(row_distances)

        result = {"metadatas": metadatas, "distances": distances}
        if "documents" in include:
            result["documents"] = documents
        return result


def get_vector_store(vector_size: int = DEFAULT_VECTOR_SIZE, collection: str = DEFAULT_COLLECTION):
    _load_dotenv()
    backend = os.getenv("VECTOR_STORE", "chroma").strip().lower()
    collection = os.getenv("QDRANT_COLLECTION", collection).strip() or collection
    if backend == "qdrant":
        return QdrantVectorStore(collection=collection, vector_size=vector_size)
    if backend == "chroma":
        return ChromaVectorStore(collection=collection)
    raise RuntimeError(f"Unsupported VECTOR_STORE '{backend}'. Use 'chroma' or 'qdrant'.")
