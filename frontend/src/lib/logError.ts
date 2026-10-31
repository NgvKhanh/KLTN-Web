/**
 * Tra ve 1 handler cho `.catch(...)` chi GHI LOG loi (khong lam sap UI).
 * Dung thay cho `.catch(() => {})` de con phat hien mat dong bo khi debug.
 *
 *   fetchX().then(setX).catch(logError('tai X'));
 */
export function logError(context: string) {
  return (err: unknown) => {
    console.error(`[${context}]`, err);
  };
}
