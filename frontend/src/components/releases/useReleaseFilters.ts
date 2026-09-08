import { useSearchParams } from "react-router-dom";
export function useReleaseFilters() {
  const [params, setParams] = useSearchParams();
  const update = (changes: Record<string, string>, reset = true) => {
    const next = new URLSearchParams(params);
    if (reset) next.delete("page");
    Object.entries(changes).forEach(([k, v]) =>
      v ? next.set(k, v) : next.delete(k),
    );
    setParams(next);
  };
  return {
    params,
    update,
    page: Math.max(1, Number(params.get("page")) || 1),
    size: [25, 50, 100].includes(Number(params.get("page_size")))
      ? Number(params.get("page_size"))
      : 25,
  };
}
