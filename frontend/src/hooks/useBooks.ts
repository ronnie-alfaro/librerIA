import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteBook, fetchBooks } from '../api/client';

export function useBooks() {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const booksQuery = useQuery({
    queryKey: ['books'],
    queryFn: fetchBooks,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBook,
    onMutate: (bookId) => setDeletingId(bookId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['books'] });
    },
    onSettled: () => setDeletingId(null),
  });

  return {
    books: booksQuery.data || [],
    loading: booksQuery.isLoading,
    error: booksQuery.error instanceof Error ? booksQuery.error.message : null,
    deletingId,
    reload: async () => {
      await queryClient.invalidateQueries({ queryKey: ['books'] });
    },
    remove: async (bookId: string) => {
      await deleteMutation.mutateAsync(bookId);
    },
  };
}
