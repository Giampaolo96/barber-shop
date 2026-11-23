// Messaggio "account eliminato" sulla home (fetta 9b): cookie usa e getta impostato da deleteAccount
// dopo l'eliminazione riuscita. La home lo legge e lo fa cancellare subito (DELETE su
// ACCOUNT_DELETED_FLASH_PATH): un link nudo alla home non mostra mai il messaggio.
export const ACCOUNT_DELETED_COOKIE = "account_deleted";
export const ACCOUNT_DELETED_FLASH_PATH = "/auth/account-eliminato";

export const ACCOUNT_DELETED_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  // Se la cancellazione non parte (JavaScript spento), il cookie scade comunque.
  maxAge: 60,
} as const;
