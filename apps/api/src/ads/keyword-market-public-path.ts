const reportPath = /^\/v1\/keyword-market\/revisions\/[0-9a-f-]+\/reports$/i;
const clickPath = /^\/v1\/keyword-market\/revisions\/[0-9a-f-]+\/click$/i;

export function isPublicKeywordMarketPath(path: string) {
  return (
    path === '/v1/keyword-market/status' ||
    path.startsWith('/v1/keyword-market/keywords/') ||
    reportPath.test(path) ||
    clickPath.test(path)
  );
}
