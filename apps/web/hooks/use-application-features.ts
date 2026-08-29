'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  APPLICATION_FEATURES_CHANGED_EVENT,
  DISABLED_APPLICATION_FEATURES,
  type ApplicationFeatures,
} from '@/lib/application-features';
import { clientApiJson } from '@/lib/http';

export function useApplicationFeatures() {
  const [features, setFeatures] = useState<ApplicationFeatures>(DISABLED_APPLICATION_FEATURES);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setFeatures(
        await clientApiJson<ApplicationFeatures>(
          '/v1/public/features',
          undefined,
          'Application features',
        ),
      );
    } catch {
      setFeatures(DISABLED_APPLICATION_FEATURES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const refreshOnVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener(APPLICATION_FEATURES_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshOnVisibility);
    return () => {
      window.removeEventListener(APPLICATION_FEATURES_CHANGED_EVENT, refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshOnVisibility);
    };
  }, [refresh]);

  return { features, loading, refresh };
}
