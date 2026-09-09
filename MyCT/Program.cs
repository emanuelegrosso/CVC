using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Data.Sqlite;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
var app = builder.Build();

app.Urls.Add("http://localhost:1967");
app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles();

// Cartella foto dedicata per ogni corso: wwwroot/foto/{cid}
string webRoot = app.Environment.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
Directory.CreateDirectory(Path.Combine(webRoot, "foto"));

// ---------- Database ----------
const string dbFile = "equipaggi.db";
string dbPath = Path.Combine(AppContext.BaseDirectory, dbFile);
var db = new SqliteConnection($"Data Source={dbPath}");
db.Open();
InitDb(db);

// ---------- Helpers ----------
static int ScalarInt(SqliteConnection db, string sql, params (string, object)[] p)
{
    using var cmd = db.CreateCommand();
    cmd.CommandText = sql;
    foreach (var (k, v) in p) cmd.Parameters.AddWithValue(k, v);
    return Convert.ToInt32(cmd.ExecuteScalar() ?? 0);
}
static List<Dictionary<string, object?>> Query(SqliteConnection db, string sql, params (string, object)[] p)
{
    using var cmd = db.CreateCommand();
    cmd.CommandText = sql;
    foreach (var (k, v) in p) cmd.Parameters.AddWithValue(k, v);
    using var r = cmd.ExecuteReader();
    var rows = new List<Dictionary<string, object?>>();
    while (r.Read())
    {
        var row = new Dictionary<string, object?>();
        for (int i = 0; i < r.FieldCount; i++)
        {
            row[r.GetName(i)] = r.IsDBNull(i) ? null : r.GetValue(i);
        }
        rows.Add(row);
    }
    return rows;
}
static void Exec(SqliteConnection db, string sql, params (string, object)[] p)
{
    using var cmd = db.CreateCommand();
    cmd.CommandText = sql;
    foreach (var (k, v) in p) cmd.Parameters.AddWithValue(k, v);
    cmd.ExecuteNonQuery();
}

// ----- JSON body helpers -----
static string? JStr(JsonElement b, string prop)
    => b.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

static int JInt(JsonElement b, string prop, int def = 0)
{
    if (!b.TryGetProperty(prop, out var v)) return def;
    return v.ValueKind switch
    {
        JsonValueKind.Number => v.GetInt32(),
        JsonValueKind.String => int.TryParse(v.GetString(), out var i) ? i : def,
        _ => def
    };
}

static double JDouble(JsonElement b, string prop, double def = 0)
{
    if (!b.TryGetProperty(prop, out var v)) return def;
    return v.ValueKind switch
    {
        JsonValueKind.Number => v.GetDouble(),
        JsonValueKind.String => double.TryParse(v.GetString(), out var d) ? d : def,
        _ => def
    };
}

void InitDb(SqliteConnection db)
{
    Exec(db, @"CREATE TABLE IF NOT EXISTS Corsi (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        Sigla TEXT NOT NULL, Turno INTEGER, Anno INTEGER,
        DataInizio TEXT, DataFine TEXT, Giorni INTEGER, Note TEXT
    )");
    Exec(db, @"CREATE TABLE IF NOT EXISTS Barche (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        CorsoId INTEGER, Nome TEXT NOT NULL, Capienza INTEGER, Tipo TEXT, Note TEXT
    )");
    Exec(db, @"CREATE TABLE IF NOT EXISTS Persone (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        CorsoId INTEGER, SitoId TEXT, Ruolo TEXT,
        Nome TEXT, Cognome TEXT, DataNascita TEXT, Foto TEXT, Telefono TEXT,
        Peso REAL, Sesso TEXT, Esperienza INTEGER, Note TEXT
    )");
    Exec(db, @"CREATE TABLE IF NOT EXISTS Equipaggi (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        CorsoId INTEGER, Giorno INTEGER, BarcaId INTEGER, PersonaId INTEGER, RuoloBordo TEXT
    )");
    Exec(db, "CREATE INDEX IF NOT EXISTS idx_equip_corso ON Equipaggi(CorsoId, Giorno)");
}

app.MapGet("/api/db/reset", () =>
{
    Exec(db, "DROP TABLE IF EXISTS Equipaggi; DROP TABLE IF EXISTS Persone; DROP TABLE IF EXISTS Barche; DROP TABLE IF EXISTS Corsi;");
    InitDb(db);
    return Results.Ok(new { status = "reset" });
});

// ---------- Corsi ----------
app.MapGet("/api/corsi", () =>
    Query(db, "SELECT * FROM Corsi ORDER BY Anno DESC, Sigla"));

app.MapPost("/api/corsi", (JsonElement b) =>
{
    string sigla = JStr(b, "Sigla") ?? "";
    int turno = JInt(b, "Turno");
    int anno = JInt(b, "Anno", DateTime.Now.Year);
    string dIn = JStr(b, "DataInizio") ?? "";
    string dFin = JStr(b, "DataFine") ?? "";
    int giorni = JInt(b, "Giorni");
    string note = JStr(b, "Note") ?? "";
    Exec(db, "INSERT INTO Corsi(Sigla,Turno,Anno,DataInizio,DataFine,Giorni,Note) VALUES($0,$1,$2,$3,$4,$5,$6)",
        ("$0", sigla), ("$1", turno), ("$2", anno), ("$3", dIn), ("$4", dFin),
        ("$5", giorni), ("$6", note));
    return Results.Ok(new { Id = ScalarInt(db, "SELECT last_insert_rowid()") });
});

app.MapPut("/api/corsi/{id}", (int id, JsonElement b) =>
{
    string sigla = JStr(b, "Sigla") ?? "";
    int turno = JInt(b, "Turno");
    int anno = JInt(b, "Anno");
    string dIn = JStr(b, "DataInizio") ?? "";
    string dFin = JStr(b, "DataFine") ?? "";
    int giorni = JInt(b, "Giorni");
    string note = JStr(b, "Note") ?? "";
    Exec(db, "UPDATE Corsi SET Sigla=$0,Turno=$1,Anno=$2,DataInizio=$3,DataFine=$4,Giorni=$5,Note=$6 WHERE Id=$7",
        ("$0", sigla), ("$1", turno), ("$2", anno), ("$3", dIn),
        ("$4", dFin), ("$5", giorni), ("$6", note), ("$7", id));
    return Results.Ok();
});
app.MapDelete("/api/corsi/{id}", (int id) =>
{
    Exec(db, "DELETE FROM Corsi WHERE Id=$0", ("$0", id));
    Exec(db, "DELETE FROM Barche WHERE CorsoId=$0", ("$0", id));
    Exec(db, "DELETE FROM Persone WHERE CorsoId=$0", ("$0", id));
    Exec(db, "DELETE FROM Equipaggi WHERE CorsoId=$0", ("$0", id));
    // Rimuove la cartella foto dedicata al corso
    try
    {
        string dir = Path.Combine(webRoot, "foto", id.ToString());
        if (Directory.Exists(dir)) Directory.Delete(dir, true);
    }
    catch { }
    return Results.Ok();
});

// ---------- Barche ----------
app.MapGet("/api/corsi/{cid}/barche", (int cid) => Query(db, "SELECT * FROM Barche WHERE CorsoId=$0 ORDER BY Nome", ("$0", cid)));
app.MapPost("/api/corsi/{cid}/barche", (int cid, JsonElement b) =>
{
    Exec(db, "INSERT INTO Barche(CorsoId,Nome,Capienza,Tipo,Note) VALUES($0,$1,$2,$3,$4)",
        ("$0", cid), ("$1", JStr(b, "Nome") ?? ""), ("$2", JInt(b, "Capienza")), ("$3", JStr(b, "Tipo") ?? ""), ("$4", JStr(b, "Note") ?? ""));
    return Results.Ok(new { Id = ScalarInt(db, "SELECT last_insert_rowid()") });
});
app.MapPut("/api/barche/{id}", (int id, JsonElement b) =>
{
    Exec(db, "UPDATE Barche SET Nome=$0,Capienza=$1,Tipo=$2,Note=$3 WHERE Id=$4",
        ("$0", JStr(b, "Nome") ?? ""), ("$1", JInt(b, "Capienza")), ("$2", JStr(b, "Tipo") ?? ""), ("$3", JStr(b, "Note") ?? ""), ("$4", id));
    return Results.Ok();
});
app.MapDelete("/api/barche/{id}", (int id) =>
{
    Exec(db, "DELETE FROM Barche WHERE Id=$0", ("$0", id));
    Exec(db, "DELETE FROM Equipaggi WHERE BarcaId=$0", ("$0", id));
    return Results.Ok();
});

// ---------- Persone (allievi/istruttori) ----------
app.MapGet("/api/corsi/{cid}/persone", (int cid, string? ruolo) =>
{
    if (!string.IsNullOrEmpty(ruolo))
        return Query(db, "SELECT * FROM Persone WHERE CorsoId=$0 AND Ruolo=$1", ("$0", cid), ("$1", ruolo));
    return Query(db, "SELECT * FROM Persone WHERE CorsoId=$0", ("$0", cid));
});
app.MapPost("/api/corsi/{cid}/persone", (int cid, JsonElement b) =>
{
    Exec(db, @"INSERT INTO Persone(CorsoId,SitoId,Ruolo,Nome,Cognome,DataNascita,Foto,Telefono,Peso,Sesso,Esperienza,Note)
               VALUES($0,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        ("$0", cid), ("$1", JStr(b, "SitoId") ?? ""), ("$2", JStr(b, "Ruolo") ?? ""), ("$3", JStr(b, "Nome") ?? ""), ("$4", JStr(b, "Cognome") ?? ""),
        ("$5", JStr(b, "DataNascita") ?? ""), ("$6", JStr(b, "Foto") ?? ""), ("$7", JStr(b, "Telefono") ?? ""),
        ("$8", JDouble(b, "Peso")), ("$9", JStr(b, "Sesso") ?? ""), ("$10", JInt(b, "Esperienza")), ("$11", JStr(b, "Note") ?? ""));
    return Results.Ok(new { Id = ScalarInt(db, "SELECT last_insert_rowid()") });
});
app.MapPut("/api/persone/{id}", (int id, JsonElement b) =>
{
    Exec(db, @"UPDATE Persone SET Nome=$0,Cognome=$1,DataNascita=$2,Foto=$3,Telefono=$4,Peso=$5,Sesso=$6,Esperienza=$7,Note=$8,Ruolo=$9 WHERE Id=$10",
        ("$0", JStr(b, "Nome") ?? ""), ("$1", JStr(b, "Cognome") ?? ""), ("$2", JStr(b, "DataNascita") ?? ""), ("$3", JStr(b, "Foto") ?? ""),
        ("$4", JStr(b, "Telefono") ?? ""), ("$5", JDouble(b, "Peso")), ("$6", JStr(b, "Sesso") ?? ""),
        ("$7", JInt(b, "Esperienza")), ("$8", JStr(b, "Note") ?? ""), ("$9", JStr(b, "Ruolo") ?? ""), ("$10", id));
    return Results.Ok();
});
app.MapDelete("/api/persone/{id}", (int id) =>
{
    Exec(db, "DELETE FROM Persone WHERE Id=$0", ("$0", id));
    Exec(db, "DELETE FROM Equipaggi WHERE PersonaId=$0", ("$0", id));
    return Results.Ok();
});

// ---------- Import (Chrome Extension) ----------
// Scarica le foto in wwwroot/foto/{cid}/ e salva il percorso locale nel DB.
// Le foto CVC vanno scaricate tramite il proxy del sito:
//   https://www.centrovelicocaprera.it/wp-content/plugins/pw-custom-cvc-wc/helper/getDocs.php?url=<url>
// perché il download diretto dell'immagine restituisce una pagina PHP invece dei byte.
const string CVC_DOMAIN = "https://www.centrovelicocaprera.it";
const string CVC_PROXY_PATH = "/wp-content/plugins/pw-custom-cvc-wc/helper/getDocs.php";

// Estensione corrispondente al Content-Type
static string ExtFromMediaType(string? mediaType, string fallback)
{
    return mediaType?.ToLowerInvariant() switch
    {
        "image/jpeg" or "image/pjpeg" => ".jpg",
        "image/png" => ".png",
        "image/gif" => ".gif",
        "image/webp" => ".webp",
        "image/bmp" => ".bmp",
        "image/svg+xml" => ".svg",
        "image/tiff" => ".tiff",
        _ => fallback
    };
}

// Estrae l'URL "vero" dell'immagine da un possibile URL proxy getDocs.php
// (es. .../getDocs.php?url=https%3A%2F%2F...file.jpeg -> https://.../file.jpeg)
static string ExtractImageUrl(string fullUrl)
{
    try
    {
        var u = new Uri(fullUrl);
        string? query = u.Query.TrimStart('?');
        if (string.IsNullOrEmpty(query)) return fullUrl;
        // parse query params manualmente (niente System.Web in ASP.NET Core)
        foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            int eq = pair.IndexOf('=');
            string key = eq >= 0 ? pair[..eq] : pair;
            if (key.Equals("url", StringComparison.OrdinalIgnoreCase))
            {
                string embedded = eq >= 0 ? Uri.UnescapeDataString(pair[(eq + 1)..]) : "";
                if (string.IsNullOrWhiteSpace(embedded)) return fullUrl;
                return embedded.StartsWith("http", StringComparison.OrdinalIgnoreCase)
                    ? embedded
                    : CVC_DOMAIN + embedded;
            }
        }
    }
    catch { }
    return fullUrl;
}

string DownloadFoto(string? url, int cid, string? sitoId, int index)
{
    if (string.IsNullOrWhiteSpace(url)) return "";

    // Caso: foto già arrivata come data URL base64 (es. data:image/jpeg;base64,....)
    // scaricata dal content script con la sessione CVC. Salviamola direttamente in locale.
    if (url.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
    {
        try
        {
            int comma = url.IndexOf(',');
            if (comma < 0) return url;
            string header = url[..comma];
            string b64 = url[(comma + 1)..];
            // Estrai il media type (es. image/jpeg) dalla testata
            string mediaType = "";
            int semi = header.IndexOf(';');
            if (semi > 0) mediaType = header[5..semi]; // salta "data:"
            else if (header.Length > 5) mediaType = header[5..];

            byte[] bytes;
            try { bytes = Convert.FromBase64String(b64); }
            catch { return url; }

            if (bytes.Length < 100) return url;

            string fallbackExt = ".jpg";
            if (!string.IsNullOrEmpty(mediaType)) fallbackExt = ExtFromMediaType(mediaType, fallbackExt);

            string dir = Path.Combine(webRoot, "foto", cid.ToString());
            Directory.CreateDirectory(dir);
            string nomeFile = $"{DateTime.Now:yyyyMMddHHmmss}_{index}{fallbackExt}";
            string localPath = Path.Combine(dir, nomeFile);
            File.WriteAllBytes(localPath, bytes);
            return $"/foto/{cid}/{nomeFile}";
        }
        catch { return url; }
    }

    try
    {
        // L'URL potrebbe essere assoluto oppure relativo (es. /wp-content/uploads/...)
        string fullUrl = url.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? url
            : CVC_DOMAIN + url;

        // Se è già un'URL proxy getDocs.php usalo com'è, altrimenti avvolgilo nel proxy.
        string downloadUrl = fullUrl.Contains("getDocs.php", StringComparison.OrdinalIgnoreCase)
            ? fullUrl
            : CVC_DOMAIN + CVC_PROXY_PATH + "?url=" + Uri.EscapeDataString(fullUrl);

        // Estensione di fallback dall'URL "vero" dell'immagine (mai .php)
        string fallbackExt = ".jpg";
        try
        {
            string realImage = ExtractImageUrl(fullUrl);
            string origExt = Path.GetExtension(new Uri(realImage).AbsolutePath);
            if (!string.IsNullOrEmpty(origExt) && origExt.Length <= 5 && origExt.StartsWith(".", StringComparison.Ordinal))
                fallbackExt = origExt.ToLowerInvariant();
        }
        catch { /* URL non valido -> usa fallback */ }

        string dir = Path.Combine(webRoot, "foto", cid.ToString());
        Directory.CreateDirectory(dir);

        using var hc = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        using var resp = hc.GetAsync(downloadUrl).Result;
        if (!resp.IsSuccessStatusCode) return url;

        // Estensione reale dal Content-Type della risposta
        string? mediaType = resp.Content.Headers.ContentType?.MediaType;
        string ext = ExtFromMediaType(mediaType, fallbackExt);

        // Il Content-Type deve essere un'immagine (o octet-stream): altrimenti il download è fallito.
        bool isImage = string.IsNullOrEmpty(mediaType)
            || mediaType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
            || mediaType.Equals("application/octet-stream", StringComparison.OrdinalIgnoreCase);
        if (!isImage) return url;

        string nomeFile = $"{DateTime.Now:yyyyMMddHHmmss}_{index}{ext}";
        string localPath = Path.Combine(dir, nomeFile);

        using var stream = resp.Content.ReadAsStreamAsync().Result;
        using (var fs = File.Create(localPath))
        {
            stream.CopyTo(fs);
        }

        // Se il file è troppo piccolo (poco probabile come immagine reale), scartalo.
        var fi = new FileInfo(localPath);
        if (fi.Length < 100)
        {
            try { File.Delete(localPath); } catch { }
            return url;
        }

        return $"/foto/{cid}/{nomeFile}";
    }
    catch { return url; }
}

app.MapPost("/api/import/{cid}/allievi", (int cid, List<JsonElement> data) =>
{
    int n = 0;
    int idx = 0;
    foreach (var p in data)
    {
        string foto = DownloadFoto(JStr(p, "Foto"), cid, JStr(p, "SitoId"), idx++);
        string ruolo = JStr(p, "Ruolo") ?? "ALLIEVO";
        Exec(db, @"INSERT OR REPLACE INTO Persone(CorsoId,SitoId,Ruolo,Nome,Cognome,DataNascita,Foto,Telefono,Peso,Sesso,Esperienza,Note)
                   VALUES($0,$1,$2,$3,$4,$5,$6,$7,0,'',0,'')",
            ("$0", cid), ("$1", JStr(p, "SitoId") ?? ""), ("$2", ruolo), ("$3", JStr(p, "Nome") ?? ""), ("$4", JStr(p, "Cognome") ?? ""),
            ("$5", JStr(p, "DataNascita") ?? ""), ("$6", foto), ("$7", JStr(p, "Telefono") ?? ""));
        n++;
    }
    return Results.Ok(new { imported = n });
});
app.MapPost("/api/import/{cid}/istruttori", (int cid, List<JsonElement> data) =>
{
    int n = 0;
    int idx = 1000;
    foreach (var p in data)
    {
        string foto = DownloadFoto(JStr(p, "Foto"), cid, JStr(p, "SitoId"), idx++);
        string ruolo = JStr(p, "Ruolo") ?? "IS";
        Exec(db, @"INSERT OR REPLACE INTO Persone(CorsoId,SitoId,Ruolo,Nome,Cognome,DataNascita,Foto,Telefono,Peso,Sesso,Esperienza,Note)
                   VALUES($0,$1,$2,$3,$4,$5,$6,$7,0,'',0,'')",
            ("$0", cid), ("$1", JStr(p, "SitoId") ?? ""), ("$2", ruolo), ("$3", JStr(p, "Nome") ?? ""), ("$4", JStr(p, "Cognome") ?? ""),
            ("$5", JStr(p, "DataNascita") ?? ""), ("$6", foto), ("$7", JStr(p, "Telefono") ?? ""));
        n++;
    }
    return Results.Ok(new { imported = n });
});

// ---------- Generazione Equipaggi ----------
app.MapGet("/api/corsi/{cid}/genera", (int cid) =>
{
    var corsi = Query(db, "SELECT * FROM Corsi WHERE Id=$0", ("$0", cid));
    if (corsi.Count == 0) return Results.NotFound();
    int giorni = Convert.ToInt32(corsi[0]["Giorni"] ?? 1);
    var allievi = Query(db, "SELECT * FROM Persone WHERE CorsoId=$0 AND Ruolo='ALLIEVO'", ("$0", cid));
    var istruttori = Query(db, "SELECT * FROM Persone WHERE CorsoId=$0 AND Ruolo IN ('IS','ADV','AT')", ("$0", cid));
    var barche = Query(db, "SELECT * FROM Barche WHERE CorsoId=$0", ("$0", cid));

    // Algoritmo: peso -> eta -> esperienza -> sesso
    var allieviSorted = allievi
        .OrderByDescending(a => Convert.ToDouble(a["Peso"] ?? 0))
        .ThenByDescending(a => CalcAge(Convert.ToString(a["DataNascita"])))
        .ThenByDescending(a => Convert.ToInt32(a["Esperienza"] ?? 0))
        .ThenBy(a => Convert.ToString(a["Sesso"]))
        .ToList();

    // azzera equipaggi
    Exec(db, "DELETE FROM Equipaggi WHERE CorsoId=$0", ("$0", cid));

    int personaIdx = 0;
    for (int giorno = 1; giorno <= giorni; giorno++)
    {
        foreach (var barca in barche)
        {
            int barcaId = Convert.ToInt32(barca["Id"]);
            int capienza = Convert.ToInt32(barca["Capienza"] ?? 0);
            if (capienza <= 2) continue; // richiesta capienza > 2

            // istruttore come comandante
            if (istruttori.Count > 0)
            {
                var inst = istruttori[(giorno - 1) % istruttori.Count];
                int instId = Convert.ToInt32(inst["Id"]);
                Exec(db, "INSERT INTO Equipaggi(CorsoId,Giorno,BarcaId,PersonaId,RuoloBordo) VALUES($0,$1,$2,$3,'COMANDANTE')",
                    ("$0", cid), ("$1", giorno), ("$2", barcaId), ("$3", instId));
            }

            // equipaggio
            int posti = capienza - 1;
            for (int i = 0; i < posti && personaIdx < allieviSorted.Count; i++)
            {
                var a = allieviSorted[personaIdx++];
                int aId = Convert.ToInt32(a["Id"]);
                Exec(db, "INSERT INTO Equipaggi(CorsoId,Giorno,BarcaId,PersonaId,RuoloBordo) VALUES($0,$1,$2,$3,'EQUIPAGGIO')",
                    ("$0", cid), ("$1", giorno), ("$2", barcaId), ("$3", aId));
            }
        }
    }

    return Results.Ok(new { giorni = giorni, allievi = allievi.Count, istruttori = istruttori.Count, barche = barche.Count });
});

static int CalcAge(string? date)
{
    if (string.IsNullOrEmpty(date)) return 0;
    if (DateTime.TryParse(date, out var d)) return (DateTime.Now.Year - d.Year);
    return 0;
}

// ---------- Equipaggi ----------
app.MapGet("/api/corsi/{cid}/equipaggi", (int cid) =>
    Query(db, @"SELECT e.*, b.Nome AS BarcaNome, p.Nome AS PersonaNome, p.Cognome AS PersonaCognome
                FROM Equipaggi e
                JOIN Barche b ON b.Id = e.BarcaId
                JOIN Persone p ON p.Id = e.PersonaId
                WHERE e.CorsoId=$0 ORDER BY e.Giorno, b.Nome", ("$0", cid)));

app.MapPost("/api/corsi/{cid}/equipaggi", (int cid, JsonElement b) =>
{
    int giorno = JInt(b, "Giorno");
    int barcaId = JInt(b, "BarcaId");
    int personaId = JInt(b, "PersonaId");
    string ruolo = JStr(b, "RuoloBordo") ?? "";
    Exec(db, "INSERT INTO Equipaggi(CorsoId,Giorno,BarcaId,PersonaId,RuoloBordo) VALUES($0,$1,$2,$3,$4)",
        ("$0", cid), ("$1", giorno), ("$2", barcaId), ("$3", personaId), ("$4", ruolo));
    return Results.Ok(new { Id = ScalarInt(db, "SELECT last_insert_rowid()") });
});
app.MapDelete("/api/equipaggi/{id}", (int id) =>
{
    Exec(db, "DELETE FROM Equipaggi WHERE Id=$0", ("$0", id));
    return Results.Ok();
});

app.MapGet("/health", () => Results.Ok(new { status = "ok", timestamp = DateTime.UtcNow }));

var task = app.RunAsync();

// Wait until the server is actually accepting connections before opening the browser
var readyUrl = "http://localhost:1967";
for (int i = 0; i < 50; i++)
{
    try
    {
        using var hc = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(1) };
        var resp = await hc.GetAsync($"{readyUrl}/health");
        if (resp.IsSuccessStatusCode) break;
    }
    catch { /* server not ready yet */ }
    await Task.Delay(200);
}
//OpenBrowser(readyUrl);
task.Wait();

static void OpenBrowser(string url)
{
    try
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        else if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            Process.Start("xdg-open", url);
        else if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
            Process.Start("open", url);
    }
    catch (Exception ex) { Console.WriteLine($"Browser error: {ex.Message}"); }
}