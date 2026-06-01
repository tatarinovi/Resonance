type ListPaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  isLoading?: boolean;
  onPageChange: (page: number) => void;
};

export function ListPagination({ page, pageSize, total, isLoading = false, onPageChange }: ListPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = total === 0 ? 0 : Math.min(total, safePage * pageSize);

  if (total <= pageSize && total > 0) {
    return (
      <div className="mt-4 text-xs text-muted-foreground">
        Показано {from}-{to} из {total}
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>
        Показано {from}-{to} из {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isLoading || safePage <= 1}
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          className="h-8 rounded-md border border-border px-3 font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Назад
        </button>
        <span className="min-w-16 text-center">
          {safePage} / {totalPages}
        </span>
        <button
          type="button"
          disabled={isLoading || safePage >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
          className="h-8 rounded-md border border-border px-3 font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Вперёд
        </button>
      </div>
    </div>
  );
}
