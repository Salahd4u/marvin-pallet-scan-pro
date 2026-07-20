import { detectWithKie } from "./kieDetection";

/**
 * Real AI detection entry point.
 *
 * Uses the kie.ai Gemini 3 Flash vision model to detect every visible wood
 * piece on the pallet face, then performs deterministic post-processing
 * (numbering, sorting, size analysis, anomaly detection) locally.
 *
 * No mock data, no on-device fallback — if the API call fails, the caller
 * surfaces the error to the user.
 */
export { detectWithKie as detectOnDevice } from "./kieDetection";
export { detectWithKie };
