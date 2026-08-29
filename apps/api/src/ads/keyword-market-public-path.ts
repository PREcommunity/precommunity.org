const reportPath = /^\/v1\/keyword-market\/revisions\/[0-9a-f-]+\/reports$/i;

export function isPublicKeywordMarketPath(path: string) {
  return (
    path === '/v1/keyword-market/status' ||
    path === '/v1/keyword-market/resolve' ||
    path.startsWith('/v1/keyword-market/keywords/') ||
    reportPath.test(path)
  );
}
