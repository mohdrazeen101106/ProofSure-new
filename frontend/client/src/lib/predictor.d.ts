export declare class PremiumPredictor {
  init(): Promise<void>;
  predict(row: Record<string, unknown>): Promise<{ rupees: number; scaledPred: number; features: number[] }>;
  preprocess(row: Record<string, unknown>): number[];
  buildProofRequest(row: Record<string, unknown>): { raw_row: Record<string, unknown> };
}
