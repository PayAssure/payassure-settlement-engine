export type EscrowJsonRecord = Record<string, unknown>;

export function getEscrowResult(body: EscrowJsonRecord): EscrowJsonRecord {
  const result = body.Result ?? body.result;
  return result && typeof result === 'object' ? result as EscrowJsonRecord : body;
}

export function readEscrowWorkingBalance(result: EscrowJsonRecord): number | null {
  const parameters = (result.ResultParameters ?? result.resultParameters) as EscrowJsonRecord | undefined;
  const rawParameters = parameters?.ResultParameter ?? parameters?.resultParameter;
  const list = Array.isArray(rawParameters) ? rawParameters : [];
  const accountBalance = list.find((parameter) => {
    if (!parameter || typeof parameter !== 'object') return false;
    const entry = parameter as EscrowJsonRecord;
    return String(entry.Key ?? entry.key).toLowerCase() === 'accountbalance';
  }) as EscrowJsonRecord | undefined;
  const value = accountBalance?.Value ?? accountBalance?.value;
  if (value === undefined || value === null) return null;

  const balanceText = String(value).trim();
  const directValue = Number(balanceText.replace(/,/g, ''));
  if (Number.isFinite(directValue)) return directValue;

  const rows = balanceText.split('&').map((row) => row.split('|').map((part) => part.trim()));
  const workingAccount = rows.find((row) => row[0]?.toLowerCase() === 'working account');
  const candidate = workingAccount?.[workingAccount.length - 1] ?? (rows.length === 1 ? rows[0][rows[0].length - 1] : undefined);
  if (candidate === undefined) return null;
  const parsed = Number(candidate.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}
