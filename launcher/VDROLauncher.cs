using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("VDRO")]
[assembly: AssemblyDescription("VDRO audio segment extractor")]
[assembly: AssemblyProduct("VDRO")]
[assembly: AssemblyCompany("VDRO")]
[assembly: AssemblyVersion("0.1.0.0")]
[assembly: AssemblyFileVersion("0.1.0.0")]

namespace VdroLauncher
{
    internal static class Program
    {
        private static readonly Color Neon = Color.FromArgb(250, 255, 105);
        private static readonly Color Ink = Color.FromArgb(5, 5, 5);
        private static readonly Color Muted = Color.FromArgb(160, 160, 160);

        private static readonly string LogPath = Path.Combine(
            FindAppDir(),
            ".userdata",
            "launcher.log"
        );

        private static void Log(string message)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
                File.AppendAllText(
                    LogPath,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + message + Environment.NewLine
                );
            }
            catch
            {
                // Diagnostics must never prevent startup.
            }
        }

        [STAThread]
        private static void Main(string[] args)
        {
            Log("launcher start");
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // The DSH/sandbox environment can set this globally. If it leaks in,
            // Electron runs as a plain Node process and exits without a window.
            Environment.SetEnvironmentVariable("ELECTRON_RUN_AS_NODE", null);

            try
            {
                var appDir = FindAppDir();
                Log("appDir=" + appDir);
                var sourceDist = Path.Combine(appDir, "node_modules", "electron", "dist");
                var runtimeDir = Path.Combine(appDir, "runtime");
                var runtimeExe = Path.Combine(runtimeDir, "electron.exe");

                Log("sourceDist=" + sourceDist);
                Log("runtimeExe=" + runtimeExe);

                if (!File.Exists(runtimeExe))
                {
                    if (!File.Exists(Path.Combine(sourceDist, "electron.exe")))
                    {
                        Log("electron runtime missing");
                        Fail(
                            "Electron runtime is missing.\n\n" +
                            "Run this once in the project folder:\n" +
                            "npm install"
                        );
                        return;
                    }

                    using (var splash = new SplashForm())
                    {
                        splash.Show();
                        Application.DoEvents();
                        CopyDirectory(sourceDist, runtimeDir);
                        splash.Close();
                    }
                }
                else if (
                    File.Exists(Path.Combine(sourceDist, "electron.exe")) &&
                    !RuntimeIsCurrent(sourceDist, runtimeDir)
                )
                {
                    using (var splash = new SplashForm())
                    {
                        splash.Show();
                        Application.DoEvents();
                        CopyDirectory(sourceDist, runtimeDir);
                        splash.Close();
                    }
                }

                var electron = runtimeExe;
                if (!File.Exists(electron))
                {
                    Fail("Electron runtime was not prepared correctly.");
                    return;
                }

                Log("starting " + electron + " " + Quote(appDir));
                var start = new ProcessStartInfo
                {
                    FileName = electron,
                    Arguments =
                        Quote(appDir) +
                        " --user-data-dir=" +
                        Quote(Path.Combine(appDir, ".userdata")) +
                        " --no-sandbox --disable-gpu" +
                        (args.Length == 0
                            ? string.Empty
                            : " " + string.Join(" ", Array.ConvertAll(args, Quote))),
                    WorkingDirectory = appDir,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                var process = Process.Start(start);
                Log("started pid=" + (process == null ? "null" : process.Id.ToString()));
            }
            catch (Exception ex)
            {
                Log("exception: " + ex);
                Fail("VDRO could not start.\n\n" + ex.Message);
            }
        }

        private static string FindAppDir()
        {
            var baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(
                Path.DirectorySeparatorChar,
                Path.AltDirectorySeparatorChar
            );

            if (File.Exists(Path.Combine(baseDir, "out", "main", "index.js")))
            {
                return baseDir;
            }

            var marker = Path.Combine(baseDir, "app.path");
            if (File.Exists(marker))
            {
                var marked = File.ReadAllText(marker).Trim();
                if (File.Exists(Path.Combine(marked, "out", "main", "index.js")))
                {
                    return marked;
                }
            }

            var fallback = @"U:\PPA\VDRO";
            if (File.Exists(Path.Combine(fallback, "out", "main", "index.js")))
            {
                return fallback;
            }

            return baseDir;
        }

        private static bool RuntimeIsCurrent(string sourceDist, string runtimeDir)
        {
            var sourceExe = Path.Combine(sourceDist, "electron.exe");
            var targetExe = Path.Combine(runtimeDir, "electron.exe");
            if (!File.Exists(sourceExe) || !File.Exists(targetExe))
            {
                return false;
            }

            var sourceVersion = Path.Combine(sourceDist, "version");
            var targetVersion = Path.Combine(runtimeDir, "version");
            if (!File.Exists(sourceVersion) || !File.Exists(targetVersion))
            {
                return false;
            }

            return string.Equals(
                File.ReadAllText(sourceVersion).Trim(),
                File.ReadAllText(targetVersion).Trim(),
                StringComparison.Ordinal
            );
        }

        private static void CopyDirectory(string source, string target)
        {
            if (Directory.Exists(target))
            {
                Directory.Delete(target, true);
            }
            Directory.CreateDirectory(target);

            foreach (var directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
            {
                var relative = directory.Substring(source.Length).TrimStart(
                    Path.DirectorySeparatorChar,
                    Path.AltDirectorySeparatorChar
                );
                Directory.CreateDirectory(Path.Combine(target, relative));
            }

            foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            {
                var relative = file.Substring(source.Length).TrimStart(
                    Path.DirectorySeparatorChar,
                    Path.AltDirectorySeparatorChar
                );
                var destination = Path.Combine(target, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(destination));
                File.Copy(file, destination, true);
            }
        }

        private static string Quote(string value)
        {
            return "\"" + value + "\"";
        }

        private static void Fail(string message)
        {
            MessageBox.Show(
                message,
                "VDRO",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }

        private sealed class SplashForm : Form
        {
            public SplashForm()
            {
                Text = "VDRO";
                FormBorderStyle = FormBorderStyle.None;
                StartPosition = FormStartPosition.CenterScreen;
                ClientSize = new Size(420, 132);
                BackColor = Ink;
                ShowInTaskbar = false;
                TopMost = true;

                var title = new Label
                {
                    Text = "VDRO",
                    ForeColor = Neon,
                    BackColor = Ink,
                    Font = new Font("Segoe UI", 22f, FontStyle.Bold),
                    AutoSize = true,
                    Location = new Point(24, 20)
                };

                var subtitle = new Label
                {
                    Text = "PREPARING RUNTIME",
                    ForeColor = Muted,
                    BackColor = Ink,
                    Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                    AutoSize = true,
                    Location = new Point(27, 65)
                };

                var bar = new ProgressBar
                {
                    Style = ProgressBarStyle.Marquee,
                    MarqueeAnimationSpeed = 28,
                    Location = new Point(27, 94),
                    Size = new Size(366, 6)
                };

                Controls.Add(title);
                Controls.Add(subtitle);
                Controls.Add(bar);
            }
        }
    }
}

