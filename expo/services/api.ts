import { detectWithKie } from "./kieDetection";

/**
 * Real AI detection entry point for window quality inspection.
 *
 * Uses the kie.ai Gemini 3 Flash vision model to detect every visible window
 * frame and every visible defect (scratches, cracks, chips, dents, warping,
 * misalignment, discoloration, broken glass), then performs deterministic
 * post-processing (numbering, sorting, average-size, severity) locally.
 *
 * No mock data, no on-device fallback — if the API call fails, the caller
 * surfaces the error to the user.
 */
export { detectWithKie as detectOnDevice } from "./kieDetection";
export { detectWithKie };
