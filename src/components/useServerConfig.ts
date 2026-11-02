import { useEffect, useState } from 'react';
import { devServerConfig, knownServerConfig, type DevServerConfig } from '../compiler/devServer';

/** What the server offers (null until it has answered). */
export function useServerConfig(): DevServerConfig | null {
  const [config, setConfig] = useState(knownServerConfig);
  useEffect(() => {
    let live = true;
    void devServerConfig().then((c) => live && setConfig(c));
    return () => {
      live = false;
    };
  }, []);
  return config;
}
