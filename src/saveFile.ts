// ─── Enregistrement d'un fichier via dialogue « Enregistrer sous » ────────
// Ouvre le vrai sélecteur d'emplacement natif (File System Access API) quand
// il est disponible — l'utilisateur choisit le dossier ET le nom. Repli sur le
// téléchargement classique pour les navigateurs qui ne le supportent pas
// (Firefox, Safari) : le fichier part dans le dossier de téléchargements.

export type SaveOutcome = "saved" | "downloaded" | "cancelled";

// `showSaveFilePicker` n'est pas encore typé partout dans lib.dom : on le
// déclare a minima pour ce qu'on utilise.
type SaveFilePickerFn = (options: {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}) => Promise<{
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}>;

function supportsFilePicker(win: Window): win is Window & {
  showSaveFilePicker: SaveFilePickerFn;
} {
  return typeof (win as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";
}

export async function saveBlobAs(
  blob: Blob,
  suggestedName: string,
): Promise<SaveOutcome> {
  if (supportsFilePicker(window)) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: "Document PDF",
            accept: { "application/pdf": [".pdf"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved";
    } catch (err) {
      // L'utilisateur a fermé/annulé le dialogue → ce n'est pas une erreur.
      if (err instanceof DOMException && err.name === "AbortError") {
        return "cancelled";
      }
      throw err;
    }
  }

  // Repli : téléchargement classique via lien.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
