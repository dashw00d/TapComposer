import { premiumRequest } from '@/lib/premium/proxy';
function handle(request: Request) {
  const bindings = process.env;
  return premiumRequest(request, {
    enabled: bindings.TAPCOMPOSER_PREMIUM_DEMO === 'true',
    origin: bindings.TAPCOMPOSER_INFERENCE_URL,
    token: bindings.TAPCOMPOSER_INFERENCE_KEY,
  });
}
export const GET = handle;
export const POST = handle;
