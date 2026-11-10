<?php

namespace Plugins\G7\Ckeditor5\Superpack\Tests\Unit;

require_once dirname(__DIR__).'/PluginTestCase.php';

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Plugins\G7\Ckeditor5\Superpack\Support\LinkPreviewCharset;

/**
 * 링크 프리뷰 문자셋 판정·변환 (1.7.0)
 */
class LinkPreviewCharsetTest extends TestCase
{
    /**
     * @return array<string, array{0: ?string, 1: string, 2: string}>
     */
    public static function detections(): array
    {
        return [
            '헤더 EUC-KR' => ['text/html; charset=EUC-KR', '<html>', 'UHC'],
            '헤더 따옴표' => ['text/html; charset="euc-kr"', '<html>', 'UHC'],
            '헤더 UTF-8' => ['text/html; charset=utf-8', '<meta charset="euc-kr">', 'UTF-8'],
            '헤더 우선' => ['text/html; charset=shift_jis', '<meta charset="euc-kr">', 'SJIS-win'],
            '헤더 없음 meta charset' => [null, '<head><meta charset="EUC-KR"></head>', 'UHC'],
            '헤더 charset 없음 meta' => ['text/html', '<meta charset=cp949>', 'UHC'],
            'http-equiv' => [null, '<meta http-equiv="Content-Type" content="text/html; charset=ks_c_5601-1987">', 'UHC'],
            '모르는 헤더 → meta' => ['text/html; charset=x-unknown', '<meta charset="gbk">', 'CP936'],
            '모르는 이름 → UTF-8' => [null, '<meta charset="koi8-r">', 'UTF-8'],
            '판정 불가 → UTF-8' => [null, '<html><head><title>x</title>', 'UTF-8'],
            'latin1' => ['text/html; charset=ISO-8859-1', '', 'Windows-1252'],
            'big5' => [null, '<meta charset="big5">', 'BIG-5'],
        ];
    }

    #[DataProvider('detections')]
    public function test_detect(?string $contentType, string $html, string $expected): void
    {
        $this->assertSame($expected, LinkPreviewCharset::detect($contentType, $html));
    }

    public function test_meta_after_scan_window_is_ignored(): void
    {
        $html = str_repeat(' ', 5000).'<meta charset="euc-kr">';
        $this->assertSame('UTF-8', LinkPreviewCharset::detect(null, $html));
    }

    public function test_euc_kr_title_becomes_utf8(): void
    {
        $utf8 = '<title>한국어 제목</title>';
        $euckr = mb_convert_encoding($utf8, 'UHC', 'UTF-8');
        $this->assertFalse(mb_check_encoding($euckr, 'UTF-8'));

        $out = LinkPreviewCharset::toUtf8($euckr, 'UHC');
        $this->assertSame($utf8, $out);
    }

    public function test_shift_jis_becomes_utf8(): void
    {
        $utf8 = '日本語のタイトル';
        $sjis = mb_convert_encoding($utf8, 'SJIS-win', 'UTF-8');
        $this->assertSame($utf8, LinkPreviewCharset::toUtf8($sjis, 'SJIS-win'));
    }

    public function test_utf8_is_returned_unchanged(): void
    {
        $s = '<title>그대로</title>';
        $this->assertSame($s, LinkPreviewCharset::toUtf8($s, 'UTF-8'));
    }

    public function test_unknown_encoding_name_is_not_converted(): void
    {
        $s = "\xB0\xA1";
        $this->assertSame($s, LinkPreviewCharset::toUtf8($s, 'KOI8-R'));
    }

    public function test_empty_string(): void
    {
        $this->assertSame('', LinkPreviewCharset::toUtf8('', 'UHC'));
    }
}
