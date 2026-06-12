/**
 * Compatibility shim: exposes a wouter-shaped API on top of react-router-dom v6.
 *
 * Pages copied from the reference were written against wouter, which has a
 * compact API (`useLocation()` returns `[path, navigate]`, `<Link href>`).
 * Reimplementing the same shape lets us keep page code untouched while routing
 * on top of `react-router-dom` in the actual app shell.
 */
import * as React from "react";
import {
  Link as RouterLink,
  useLocation as useRouterLocation,
  useNavigate,
  useParams as useRouterParams,
  useSearchParams as useRouterSearchParams,
  matchPath,
} from "react-router-dom";

export type LocationTuple = [string, (path: string, options?: { replace?: boolean }) => void];

/**
 * Wouter's `useLocation` returns a `[path, navigate]` tuple. We mimic that to
 * minimise churn in the reference UI components.
 */
export function useLocation(): LocationTuple {
  const location = useRouterLocation();
  const navigate = useNavigate();
  const setLocation = React.useCallback(
    (path: string, options?: { replace?: boolean }) => navigate(path, options),
    [navigate],
  );
  return [location.pathname, setLocation];
}

export function useRoute<TParams extends Record<string, string> = Record<string, string>>(
  pattern: string,
): [boolean, TParams | null] {
  const location = useRouterLocation();
  const match = matchPath({ path: pattern, end: true }, location.pathname);
  if (!match) return [false, null];
  return [true, (match.params as TParams) ?? null];
}

export const useParams = useRouterParams;
export const useSearchParams = useRouterSearchParams;

export interface LinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  children?: React.ReactNode;
  replace?: boolean;
  state?: unknown;
}

/**
 * Wouter's `<Link href>` accepts arbitrary children; many of the reference UI
 * components wrap a single `<span>` inside `<Link>`. react-router's `<Link to>`
 * applies an extra anchor wrapper, so we forward children unchanged.
 */
export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  function Link({ href, children, replace, state, className, ...rest }, ref) {
    return (
      <RouterLink ref={ref} to={href} replace={replace} state={state} className={className} {...rest}>
        {children}
      </RouterLink>
    );
  },
);

export const Redirect = ({ to }: { to: string }) => {
  const navigate = useNavigate();
  React.useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
};
