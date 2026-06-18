/** Result of probing a single dependency. */
export interface HealthDetail {
  status: 'up' | 'down';
  error?: string;
}
