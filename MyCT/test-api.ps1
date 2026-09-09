$ErrorActionPreference = 'Stop'
$base = 'http://localhost:1967'

# 1. Crea corso
$body = @{ Sigla = 'TST'; Turno = 1; Anno = 2026; DataInizio = '2026-07-01'; DataFine = '2026-07-10'; Giorni = 3; Note = 'Test debug' } | ConvertTo-Json
$corso = Invoke-RestMethod -Uri "$base/api/corsi" -Method Post -ContentType 'application/json' -Body $body
$cid = $corso.Id
Write-Host "Corso creato ID=$cid"

# 2. Barche
$b1 = Invoke-RestMethod -Uri "$base/api/corsi/$cid/barche" -Method Post -ContentType 'application/json' -Body (@{ Nome = 'Barca A'; Capienza = 5; Tipo = 'Deriva' } | ConvertTo-Json)
$b2 = Invoke-RestMethod -Uri "$base/api/corsi/$cid/barche" -Method Post -ContentType 'application/json' -Body (@{ Nome = 'Barca B'; Capienza = 4; Tipo = 'Deriva' } | ConvertTo-Json)
Write-Host "Barche: $($b1.Id), $($b2.Id)"

# 3. Allievi (6)
for ($i = 1; $i -le 6; $i++) {
    $p = @{ Nome = 'Allievo'; Cognome = "Num$i"; Ruolo = 'ALLIEVO'; Peso = (50 + $i * 5); Sesso = 'M' } | ConvertTo-Json
    Invoke-RestMethod -Uri "$base/api/corsi/$cid/persone" -Method Post -ContentType 'application/json' -Body $p | Out-Null
}
Write-Host 'Allievi: 6 creati'

# 4. Istruttori (2)
for ($i = 1; $i -le 2; $i++) {
    $p = @{ Nome = 'Istruttore'; Cognome = "Num$i"; Ruolo = 'IS' } | ConvertTo-Json
    Invoke-RestMethod -Uri "$base/api/corsi/$cid/persone" -Method Post -ContentType 'application/json' -Body $p | Out-Null
}
Write-Host 'Istruttori: 2 creati'

# 5. Genera equipaggi
$gen = Invoke-RestMethod -Uri "$base/api/corsi/$cid/genera" -Method Get
Write-Host "Generato: giorni=$($gen.giorni) allievi=$($gen.allievi) istruttori=$($gen.istruttori) barche=$($gen.barche)"

# 6. Leggi equipaggi
$eq = Invoke-RestMethod -Uri "$base/api/corsi/$cid/equipaggi" -Method Get
Write-Host "Equipaggi totali: $($eq.Count)"
$eq | Group-Object Giorno | ForEach-Object { Write-Host "  Giorno $($_.Name): $($_.Count) assegnazioni" }

# 7. Pulizia
Invoke-RestMethod -Uri "$base/api/corsi/$cid" -Method Delete | Out-Null
Write-Host 'Test completato e corso eliminato'