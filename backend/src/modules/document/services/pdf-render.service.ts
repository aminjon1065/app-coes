import { Injectable, NotFoundException } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

@Injectable()
export class PdfRenderService {
  private readonly templatesDir = join(__dirname, '..', 'templates');

  async renderFromTemplate(
    templateCode: string,
    vars: Record<string, unknown>,
  ): Promise<Buffer> {
    const source = await this.loadTemplate(templateCode);
    const content = this.interpolate(source, vars);

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    page.drawText(templateCode.toUpperCase(), {
      x: 50,
      y: 790,
      size: 18,
      font: fontBold,
      color: rgb(0.11, 0.16, 0.24),
    });

    const lines = content.split('\n');
    let y = 750;
    for (const line of lines) {
      page.drawText(line.slice(0, 110), {
        x: 50,
        y,
        size: 11,
        font,
        color: rgb(0.18, 0.2, 0.24),
      });
      y -= 16;
      if (y < 60) {
        y = 750;
        pdf.addPage([595.28, 841.89]);
      }
    }

    const bytes = await pdf.save();
    return Buffer.from(bytes);
  }

  private async loadTemplate(templateCode: string): Promise<string> {
    const file = join(this.templatesDir, `${templateCode}.hbs`);
    try {
      return await readFile(file, 'utf8');
    } catch {
      throw new NotFoundException('DOCUMENT_TEMPLATE_NOT_FOUND');
    }
  }

  private interpolate(source: string, vars: Record<string, unknown>): string {
    return source.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
      const value = key.split('.').reduce((acc: unknown, part: string) => {
        if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
          return (acc as Record<string, unknown>)[part];
        }
        return '';
      }, vars);
      return value == null ? '' : String(value);
    });
  }
}
