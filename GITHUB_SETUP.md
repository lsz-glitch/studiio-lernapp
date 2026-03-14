# Studiio auf GitHub sichern

Dein Code ist lokal mit Git versioniert. So bringst du ihn zu GitHub:

## 1. Neues Repository auf GitHub anlegen

1. Gehe zu [github.com](https://github.com) und melde dich an.
2. Klicke auf **„New“** (oder **„+“** → **„New repository“**).
3. **Repository name:** z. B. `studiio-lernapp`
4. **Public** auswählen (oder Private, wenn nur du es siehst).
5. **Nicht** „Add a README“ oder „Add .gitignore“ anhaken – das Projekt existiert schon.
6. Auf **„Create repository“** klicken.

## 2. Lokales Projekt mit GitHub verbinden

GitHub zeigt dir danach Befehle an. Du brauchst nur diese zwei (ersetze `DEIN-USERNAME` und `studiio-lernapp` durch deine Angaben):

```bash
cd /Users/Lisa/Documents/studiio.Lernapp

# Remote hinzufügen (URL von GitHub kopieren)
git remote add origin https://github.com/DEIN-USERNAME/studiio-lernapp.git

# Code hochladen
git push -u origin main
```

Beim ersten `git push` wirst du nach deinem GitHub-Benutzernamen und Passwort/Token gefragt.  
**Hinweis:** GitHub akzeptiert kein normales Passwort mehr – du brauchst einen **Personal Access Token**. Erstellen unter: GitHub → Einstellungen → Developer settings → Personal access tokens.

## 3. Später: Änderungen sichern

Wenn du etwas geändert hast:

```bash
git add .
git status          # optional: prüfen was committed wird
git commit -m "Kurze Beschreibung der Änderung"
git push
```

---

Du kannst diese Datei (GITHUB_SETUP.md) löschen oder behalten, wie du möchtest.
