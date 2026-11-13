import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function login(payload: Record<string, unknown>, supabase: SupabaseClient,
  jsonResponse: (status: number, body: unknown) => Response): Promise<Response> {
  if (typeof payload.p_usuario !== "string" || typeof payload.p_pasahitza !== "string") {
    return jsonResponse(404, { error: "Ekintza hori ez da ezagutzen; eguneratu metro-api funtzioa" });
  }

  if (payload.p_keep_signed_in !== undefined && typeof payload.p_keep_signed_in !== "boolean") {
    return jsonResponse(400, { error: "Datuak ez dira baliozkoak" });
  }

  const username = typeof payload.p_usuario === "string"
    ? payload.p_usuario.trim().toLowerCase()
    : "";
  const password = typeof payload.p_pasahitza === "string"
    ? payload.p_pasahitza
    : "";
  if (!username || !password || username.length > 200 || password.length > 1024) {
    return jsonResponse(400, { error: "Usuario o contraseña no válidos" });
  }

  const { data, error } = await supabase.rpc("verificar_login_7metro", {
    p_usuario: username,
    p_pasahitza: password,
  });

  if (error) {
    console.error("Falló la verificación del login:", error.message);
    return jsonResponse(500, { error: "No se pudo comprobar el inicio de sesión" });
  }
  if (data !== true) {
    return jsonResponse(401, { error: "Usuario o contraseña incorrectos" });
  }

  const { data: user, error: userError } = await supabase
    .from("erabiltzaileak")
    .select("id_erabiltzailea, izena")
    .eq("izena", username)
    .maybeSingle();
  if (userError || !user) {
    console.error("No se pudo obtener el usuario validado:", userError?.message);
    return jsonResponse(500, { error: "No se pudo crear la sesión" });
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const tokenDigest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const tokenHash = Array.from(new Uint8Array(tokenDigest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const expiresIn = payload.p_keep_signed_in === true ? null : 12 * 60 * 60;
  const { error: sessionError } = await supabase.from("api_sessions").insert({
    token_hash: tokenHash,
    user_id: user.id_erabiltzailea,
    // PostgreSQL float8 infinity keeps existing expiry checks and push cleanup valid.
    expires_at: expiresIn === null ? "Infinity" : Math.floor(Date.now() / 1000) + expiresIn,
  });
  if (sessionError) {
    console.error("No se pudo guardar la sesión:", sessionError.message);
    return jsonResponse(500, { error: "No se pudo crear la sesión" });
  }

  return jsonResponse(200, {
    ok: true,
    token,
    expires_in: expiresIn,
    user: {
      id_erabiltzailea: user.id_erabiltzailea,
      izena: user.izena,
    },
  });
}
