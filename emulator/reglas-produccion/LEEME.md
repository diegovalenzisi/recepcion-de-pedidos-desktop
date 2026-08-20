# Respaldo de reglas de produccion

Estado al 2026-08-20. **Solo se pudo respaldar 1 de 7.**

| local | instancia RTDB | proyecto Firebase | acceso de dlvalenzisi@gmail.com | reglas respaldadas |
|---|---|---|---|---|
| Achaval | `achava3703-default-rtdb` | `achava3703` | SI (owner) | **SI** — `achava3703.rules.json` |
| Temperley | `bdtemperley-default-rtdb` | (no listado) | **NO** | no |
| Centenario | `centenario1199-default-rtdb` | (no listado) | **NO** | no |
| Burano | `buranoheladerias-default-rtdb` | (no listado) | **NO** | no |
| Canada | `lanyulinacanada-default-rtdb` | (no listado) | **NO** | no |
| Bynnon | `heladeriabynnonadrogue-default-rtdb` | (no listado) | **NO** | no |
| Il Capo | `ilcapogelatojls2026-default-rtdb` | (no listado) | **NO** | no |

`firebase projects:list` con esta cuenta devuelve 10 proyectos y **ninguno**
contiene esas seis instancias. `GET /.settings/rules.json` con el token de la
cuenta devuelve **401** en las seis.

Esas bases se leen y se escriben hoy **porque sus reglas son publicas**, no
porque tengamos permiso de administracion sobre ellas.

Consecuencia directa: **no se pueden publicar reglas nuevas en seis de los siete
locales desde esta cuenta.** Y sin reglas nuevas no hay create-only sobre
MOVIMIENTOS, que es lo unico que sostiene la idempotencia de la Cloud Function
sobre REST sin autenticar.

No inventar las reglas actuales de esos seis. No asumir que son iguales a las de
Achaval.
