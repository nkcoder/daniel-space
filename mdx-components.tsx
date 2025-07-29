import type { MDXComponents } from "mdx/types";
import { useMDXComponents as getThemeComponents } from 'nextra-theme-docs'; // nextra-theme-blog or your custom theme
import { Callout } from "./components/Callout";

const themeComponents = getThemeComponents()


export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    Callout,
    ...themeComponents,
    ...components
  };
}
