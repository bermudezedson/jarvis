import { createContext, useContext } from 'react';

export const JarvisContext = createContext(null);

export function useJarvis() {
  const ctx = useContext(JarvisContext);
  if (!ctx) throw new Error('useJarvis must be used inside JarvisContext.Provider');
  return ctx;
}
