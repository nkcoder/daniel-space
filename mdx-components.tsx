import type { MDXComponents } from "mdx/types";
import { ReactNode } from "react";
import { Callout } from "./components/Callout";
import { useMDXComponents as getThemeComponents } from "nextra-theme-docs";

const themeComponents = getThemeComponents();

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    // Custom components
    Callout,

    ...themeComponents,

    // Pass through other components
    ...components,
  };
}
