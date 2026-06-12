import type { DocumentPickerAsset } from 'expo-document-picker';
import type { ImagePickerAsset } from 'expo-image-picker';
import { Platform } from 'react-native';
import { createDemoParseResult, parseScheduleOcrLayout, parseScheduleText, type OcrLine } from '../lib/scheduleParser';
import type { ParseResult, Profile } from '../types';
import { supabase } from './supabase';

type PickedAsset = DocumentPickerAsset | ImagePickerAsset;

export async function parsePickedSchedule(asset: PickedAsset | null, profile: Profile): Promise<ParseResult> {
  if (!asset) {
    return createDemoParseResult(profile);
  }

  if (!supabase) {
    return parseWithBrowserOcr(asset, profile);
  }

  const fileName = 'name' in asset && asset.name ? asset.name : `schedule-${Date.now()}.jpg`;
  const filePath = `${Date.now()}-${fileName.replace(/[^\w.-]+/g, '-')}`;
  const response = await fetch(asset.uri);
  const blob = await response.blob();
  const upload = await supabase.storage.from('schedule-uploads').upload(filePath, blob, {
    contentType: 'mimeType' in asset ? asset.mimeType ?? undefined : undefined,
  });
  if (upload.error) {
    throw upload.error;
  }

  const invoked = await supabase.functions.invoke('parse-shift-upload', {
    body: {
      filePath,
      fileName,
      aliases: profile.scheduleAliases,
      timezone: profile.timezone,
    },
  });

  if (invoked.error) {
    throw invoked.error;
  }

  return invoked.data as ParseResult;
}

export function parsePastedScheduleText(text: string, profile: Profile) {
  return parseScheduleText(text, profile);
}

async function parseWithBrowserOcr(asset: PickedAsset, profile: Profile): Promise<ParseResult> {
  if (!isImageAsset(asset)) {
    return createDemoParseResult(profile);
  }

  if (Platform.OS !== 'web') {
    return {
      blocked: false,
      candidates: [],
      message: 'Image OCR needs Supabase and Google Document AI on iPhone and Android.',
      warnings: ['The local browser OCR fallback only runs in the web preview.'],
    };
  }

  try {
    const { createWorker, PSM } = (await import('tesseract.js')) as typeof import('tesseract.js');
    const worker = await createWorker('eng');
    let result: Tesseract.RecognizeResult;
    try {
      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        user_defined_dpi: '300',
      });
      result = await worker.recognize(
        getOcrImageSource(asset),
        {},
        { text: true, blocks: true, tsv: true },
      );
    } finally {
      await worker.terminate();
    }
    const lines = getOcrLines(result.data);
    const text = buildTextFromOcrResult(result.data, lines);
    if (!text) {
      return {
        blocked: false,
        candidates: [],
        message: 'OCR ran, but no readable schedule text was found.',
        warnings: ['Try a clearer image, crop to the posted calendar, or paste the text manually.'],
      };
    }

    const parsed = parseScheduleOcrLayout(text, lines, profile);
    return {
      ...parsed,
      message: parsed.candidates.length
        ? `OCR read the image. ${parsed.message}`
        : 'OCR read the image, but no shifts were confidently detected.',
      warnings: [
        ...parsed.warnings,
        `OCR text preview: ${text.replace(/\s+/g, ' ').slice(0, 180)}${text.length > 180 ? '...' : ''}`,
      ],
    };
  } catch (error) {
    return {
      blocked: false,
      candidates: [],
      message: 'Local browser OCR could not read this image.',
      warnings: [
        error instanceof Error ? error.message : 'Unknown OCR error.',
        'Paste the calendar text below or connect Supabase and Google Document AI for production OCR.',
      ],
    };
  }
}

function isImageAsset(asset: PickedAsset) {
  const mimeType = 'mimeType' in asset ? asset.mimeType : undefined;
  const name = 'name' in asset ? asset.name : asset.fileName ?? '';
  return Boolean(
    mimeType?.startsWith('image/') ||
      asset.uri.startsWith('data:image/') ||
      /\.(png|jpe?g|webp|bmp|gif)$/i.test(name ?? ''),
  );
}

function getOcrImageSource(asset: PickedAsset) {
  if ('file' in asset && asset.file) {
    return asset.file;
  }
  return asset.uri;
}

function getOcrLines(data: Tesseract.Page): OcrLine[] {
  return (
    data.blocks
      ?.flatMap((block) => block.paragraphs)
      .flatMap((paragraph) => paragraph.lines)
      .map((line) => ({
        text: line.text.trim(),
        confidence: line.confidence,
        bbox: line.bbox,
      }))
      .filter((line) => line.text) ?? []
  );
}

function buildTextFromOcrResult(data: Tesseract.Page, lines: OcrLine[]) {
  const blockLines =
    lines.map((line) => line.text).filter(Boolean);
  const text = blockLines.length ? blockLines.join('\n') : data.text;
  return text.trim();
}
