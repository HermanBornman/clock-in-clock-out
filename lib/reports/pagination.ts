export type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1_000,
): Promise<PageResult<T>> {
  const data: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) return { data: null, error: result.error };

    const page = result.data ?? [];
    data.push(...page);
    if (page.length < pageSize) return { data, error: null };
  }
}
