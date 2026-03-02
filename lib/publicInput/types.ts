export interface PublicInputSummary {
  format: 'gnark_object' | 'stark_array' | 'noir_base64';
  count: number;
}

export interface PublicInputFieldError {
  field: string;
  message: string;
}

export type PublicInputValidationResult =
  | { valid: true; publicInputs: any; summary: PublicInputSummary }
  | { valid: false; errors: PublicInputFieldError[] };
