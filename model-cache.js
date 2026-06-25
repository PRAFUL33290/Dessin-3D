(function () {
  const CACHE_NAME = 'dessin-3d-modeles-v1';
  const objectUrls = new Map();
  const pendingUrls = new Map();

  // Un fetch sans limite peut rester suspendu indéfiniment (réseau iOS
  // capricieux), ce qui figerait la promesse en cache et bloquerait le modèle
  // à 0 % pour toujours. On borne donc chaque téléchargement dans le temps.
  function fetchWithTimeout(url, ms) {
    if (typeof AbortController === 'undefined') return fetch(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  async function resolve(source) {
    if (!source) return source;

    const absoluteUrl = new URL(source, document.baseURI).href;
    if (objectUrls.has(absoluteUrl)) return objectUrls.get(absoluteUrl);
    if (pendingUrls.has(absoluteUrl)) return pendingUrls.get(absoluteUrl);

    const pending = (async () => {
      try {
        let response;

        if ('caches' in window) {
          const cache = await caches.open(CACHE_NAME);
          response = await cache.match(absoluteUrl);

          if (!response) {
            response = await fetchWithTimeout(absoluteUrl, 20000);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            try {
              await cache.put(absoluteUrl, response.clone());
            } catch (cacheError) {
              // Un quota trop faible ne doit pas provoquer un second
              // téléchargement : on garde tout de même la réponse en mémoire.
              console.warn(`[3D cache] Stockage persistant indisponible pour ${source}`, cacheError);
            }
          }
        } else {
          response = await fetchWithTimeout(absoluteUrl, 20000);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
        }

        const objectUrl = URL.createObjectURL(await response.blob());
        objectUrls.set(absoluteUrl, objectUrl);
        return objectUrl;
      } catch (error) {
        console.warn(`[3D cache] Impossible de mettre ${source} en cache`, error);
        return source;
      } finally {
        pendingUrls.delete(absoluteUrl);
      }
    })();

    pendingUrls.set(absoluteUrl, pending);
    return pending;
  }

  window.ModelAssetCache = { resolve };
})();
