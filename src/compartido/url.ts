// Para loguear la URL de un monitor sin credenciales ni tokens: le sacamos usuario,
// contraseña y query string (por ejemplo ?api_key=...). El worker le pega a cualquier
// URL que le den (ver README, sección de seguridad), así que esto es lo mínimo para no
// terminar guardando un secreto ajeno en los logs.
export function sanitizarUrl(url: string): string {
  try {
    const analizada = new URL(url);
    analizada.username = "";
    analizada.password = "";
    analizada.search = "";
    return analizada.toString();
  } catch {
    return "url_invalida";
  }
}
