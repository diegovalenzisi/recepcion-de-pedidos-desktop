using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace DLVsistema
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }
    }

    public class InstallerForm : Form
    {
        // ── Constantes ────────────────────────────────────────────────────────
        private const string FirebaseUrl =
            "https://achava3703-default-rtdb.firebaseio.com/DLVSistema/instaladores/baseFull.json";

        private static readonly string[] AllowedHosts = {
            "firebasestorage.googleapis.com",
            "firebasestorage.app",
            "storage.googleapis.com",
        };

        private static readonly string TempDir =
            Path.Combine(Path.GetTempPath(), "DLVsistema");

        private static readonly string LogPath =
            Path.Combine(Path.GetTempPath(), "DLVsistema_instalador.log");

        // ── Controles UI ─────────────────────────────────────────────────────
        private Label      _lblTitle;
        private Label      _lblSubtitle;
        private ProgressBar _progress;
        private Label      _lblStatus;
        private Label      _lblDetail;
        private Button     _btnRetry;
        private Panel      _topBand;

        public InstallerForm()
        {
            BuildUI();
            Load += async (s, e) => await RunAsync();
        }

        // ── Construcción de la UI ─────────────────────────────────────────────
        private void BuildUI()
        {
            Text            = "DLV Sistema — Instalador";
            Size            = new Size(520, 230);
            MinimumSize     = new Size(520, 230);
            MaximumSize     = new Size(520, 230);
            StartPosition   = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox     = false;
            BackColor       = Color.White;
            Font            = new Font("Segoe UI", 9f);

            // Banda azul superior
            _topBand = new Panel
            {
                Dock      = DockStyle.Top,
                Height    = 60,
                BackColor = Color.FromArgb(29, 78, 216),
            };

            _lblTitle = new Label
            {
                Text      = "DLV Sistema — Recepción de Pedidos",
                Font      = new Font("Segoe UI", 13f, FontStyle.Bold),
                ForeColor = Color.White,
                Location  = new Point(16, 10),
                Size      = new Size(480, 26),
                BackColor = Color.Transparent,
            };

            _lblSubtitle = new Label
            {
                Text      = "Instalador automático",
                Font      = new Font("Segoe UI", 9f),
                ForeColor = Color.FromArgb(191, 219, 254),
                Location  = new Point(18, 36),
                Size      = new Size(480, 18),
                BackColor = Color.Transparent,
            };

            _topBand.Controls.Add(_lblTitle);
            _topBand.Controls.Add(_lblSubtitle);

            // Estado principal
            _lblStatus = new Label
            {
                Text     = "Iniciando...",
                Font     = new Font("Segoe UI", 10f),
                Location = new Point(20, 78),
                Size     = new Size(480, 22),
            };

            // Barra de progreso
            _progress = new ProgressBar
            {
                Location = new Point(20, 106),
                Size     = new Size(476, 20),
                Style    = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 30,
            };

            // Detalle (MB / velocidad)
            _lblDetail = new Label
            {
                Text      = "",
                Font      = new Font("Segoe UI", 8.5f),
                ForeColor = Color.Gray,
                Location  = new Point(20, 132),
                Size      = new Size(476, 18),
            };

            // Botón reintentar (oculto hasta error)
            _btnRetry = new Button
            {
                Text     = "Reintentar",
                Location = new Point(196, 158),
                Size     = new Size(120, 32),
                Visible  = false,
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(29, 78, 216),
                ForeColor = Color.White,
                Font      = new Font("Segoe UI", 9f, FontStyle.Bold),
            };
            _btnRetry.FlatAppearance.BorderSize = 0;
            _btnRetry.Click += async (s, e) => {
                ResetUI();
                await RunAsync();
            };

            Controls.Add(_topBand);
            Controls.Add(_lblStatus);
            Controls.Add(_progress);
            Controls.Add(_lblDetail);
            Controls.Add(_btnRetry);
        }

        // ── Helpers de UI (thread-safe) ───────────────────────────────────────
        private void UI(Action a)
        {
            if (InvokeRequired) Invoke(a); else a();
        }

        private void SetStatus(string status, string detail = "")
        {
            UI(() => {
                _lblStatus.ForeColor = Color.FromArgb(30, 30, 30);
                _lblStatus.Text = status;
                _lblDetail.Text = detail;
            });
        }

        private void SetProgress(int pct)
        {
            UI(() => {
                if (_progress.Style != ProgressBarStyle.Blocks)
                {
                    _progress.Style   = ProgressBarStyle.Blocks;
                    _progress.Minimum = 0;
                    _progress.Maximum = 100;
                }
                _progress.Value = Math.Max(0, Math.Min(100, pct));
            });
        }

        private void ShowError(string msg)
        {
            UI(() => {
                _lblStatus.ForeColor = Color.FromArgb(185, 28, 28);
                _lblStatus.Text      = msg;
                _lblDetail.Text      = $"Log: {LogPath}";
                _progress.Style      = ProgressBarStyle.Blocks;
                _progress.Value      = 0;
                _btnRetry.Visible    = true;
            });
        }

        private void ResetUI()
        {
            UI(() => {
                _btnRetry.Visible    = false;
                _lblStatus.ForeColor = Color.FromArgb(30, 30, 30);
                _lblStatus.Text      = "Iniciando...";
                _lblDetail.Text      = "";
                _progress.Style      = ProgressBarStyle.Marquee;
                _progress.Value      = 0;
            });
        }

        // ── Log ───────────────────────────────────────────────────────────────
        private void Log(string msg)
        {
            var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {msg}";
            try { File.AppendAllText(LogPath, line + Environment.NewLine, Encoding.UTF8); }
            catch { /* no bloquear si el log falla */ }
        }

        // ── Parsing JSON sin dependencias (solo campos string de primer nivel) ──
        private static string JsonString(string json, string key)
        {
            var m = Regex.Match(json, $"\"{Regex.Escape(key)}\"\\s*:\\s*\"([^\"\\\\]*(\\\\.[^\"\\\\]*)*)\"");
            return m.Success ? Regex.Unescape(m.Groups[1].Value) : null;
        }

        // ── Flujo principal ───────────────────────────────────────────────────
        private async Task RunAsync()
        {
            Directory.CreateDirectory(TempDir);
            Log("=== DLV Sistema Bootstrapper iniciado ===");

            try
            {
                // 1. Leer metadata desde Firebase
                SetStatus("Consultando Firebase...");
                Log($"GET {FirebaseUrl}");

                string json;
                using (var wc = new WebClient())
                {
                    wc.Headers[HttpRequestHeader.Accept] = "application/json";
                    // WebClient es sync en net48; usamos DownloadStringTaskAsync
                    json = await wc.DownloadStringTaskAsync(FirebaseUrl);
                }

                Log($"Metadata: {json}");

                var url           = JsonString(json, "url");
                var nombreArchivo = JsonString(json, "nombreArchivo");
                var version       = JsonString(json, "version") ?? "?";
                var sha256        = JsonString(json, "sha256");

                if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(nombreArchivo))
                    throw new Exception("Metadata incompleta en Firebase. Falta 'url' o 'nombreArchivo'.");

                // 2. Validar dominio de descarga
                var uri = new Uri(url);
                bool allowed = false;
                foreach (var host in AllowedHosts)
                    if (uri.Host.EndsWith(host, StringComparison.OrdinalIgnoreCase)) { allowed = true; break; }

                if (!allowed)
                    throw new Exception($"URL no permitida: {uri.Host}");

                Log($"Instalador: {nombreArchivo} v{version}");
                Log($"URL validada: {url}");

                // 3. Descargar
                string destPath = Path.Combine(TempDir, nombreArchivo);
                SetStatus($"Descargando {nombreArchivo}...", "Preparando...");
                Log($"Destino: {destPath}");

                var sw      = Stopwatch.StartNew();
                var tcs     = new TaskCompletionSource<bool>();

                using (var wc = new WebClient())
                {
                    wc.DownloadProgressChanged += (s, e) =>
                    {
                        double totalMB = e.TotalBytesToReceive > 0
                            ? e.TotalBytesToReceive / 1_048_576.0
                            : 0;
                        double doneMB  = e.BytesReceived / 1_048_576.0;
                        double elapsed = sw.Elapsed.TotalSeconds;
                        double speedMB = elapsed > 0.1 ? doneMB / elapsed : 0;

                        string detail = totalMB > 0
                            ? $"{doneMB:F1} MB / {totalMB:F1} MB   —   {speedMB:F1} MB/s"
                            : $"{doneMB:F1} MB descargados   —   {speedMB:F1} MB/s";

                        SetStatus($"Descargando {nombreArchivo} v{version}...", detail);
                        SetProgress(e.ProgressPercentage);
                    };

                    wc.DownloadFileCompleted += (s, e) =>
                    {
                        if (e.Error != null) tcs.TrySetException(e.Error);
                        else if (e.Cancelled) tcs.TrySetCanceled();
                        else tcs.TrySetResult(true);
                    };

                    wc.DownloadFileAsync(new Uri(url), destPath);
                    await tcs.Task;
                }

                sw.Stop();
                Log($"Descarga completa en {sw.Elapsed.TotalSeconds:F1}s");

                // 4. Validar SHA256 (si existe en Firebase)
                if (!string.IsNullOrWhiteSpace(sha256))
                {
                    SetStatus("Validando integridad...", "Calculando SHA256...");
                    Log("Validando SHA256...");

                    string actual;
                    using (var sha = SHA256.Create())
                    using (var fs  = File.OpenRead(destPath))
                    {
                        actual = BitConverter.ToString(sha.ComputeHash(fs))
                                             .Replace("-", "")
                                             .ToLowerInvariant();
                    }

                    if (!actual.Equals(sha256.ToLowerInvariant(), StringComparison.Ordinal))
                    {
                        File.Delete(destPath);
                        Log($"SHA256 inválido. Esperado: {sha256}  Obtenido: {actual}");
                        throw new Exception("El archivo descargado está corrupto (SHA256 no coincide). Intentá de nuevo.");
                    }

                    Log($"SHA256 OK: {actual}");
                }

                // 5. Ejecutar instalador
                SetStatus("Iniciando instalador...", nombreArchivo);
                Log($"Ejecutando: {destPath}");

                Process.Start(new ProcessStartInfo
                {
                    FileName        = destPath,
                    UseShellExecute = true,
                });

                Log("Instalador ejecutado. Cerrando bootstrapper.");
                await Task.Delay(1200);
                UI(() => Application.Exit());
            }
            catch (Exception ex)
            {
                Log($"ERROR: {ex.Message}");
                ShowError(ex.Message.Length > 120 ? ex.Message.Substring(0, 120) + "…" : ex.Message);
            }
        }
    }
}
