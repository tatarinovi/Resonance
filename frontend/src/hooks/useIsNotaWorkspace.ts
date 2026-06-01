import { useAuth } from "@/contexts/AuthContext";
import { isNotaWorkspace } from "@/lib/workspace";

export function useIsNotaWorkspace(): boolean {
  const { me } = useAuth();
  return isNotaWorkspace(me?.workspace);
}
