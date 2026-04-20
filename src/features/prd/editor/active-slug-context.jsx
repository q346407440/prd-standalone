import { createContext, useContext } from 'react';
import { DEFAULT_PRD_SLUG } from './prd-constants.js';

const ActiveSlugContext = createContext(DEFAULT_PRD_SLUG);

export const ActiveSlugProvider = ActiveSlugContext.Provider;

export function useActiveSlug() {
  return useContext(ActiveSlugContext);
}
