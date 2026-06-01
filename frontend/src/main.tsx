import { createRoot } from "react-dom/client";

import "@fontsource-variable/inter";
import App from "./App";
import "./index.css";

document.documentElement.classList.add("dark");

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container not found");
}

createRoot(container).render(<App />);
