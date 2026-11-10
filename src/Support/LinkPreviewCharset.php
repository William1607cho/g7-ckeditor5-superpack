<?php

namespace Plugins\G7\Ckeditor5\Superpack\Support;

/**
 * 링크 프리뷰가 받은 HTML 의 문자셋을 판정하고 UTF-8 로 바꾸는 순수 클래스 (1.7.0).
 *
 * 판정 순서: 응답 `Content-Type` 의 `charset=` → `<meta charset>` → `<meta http-equiv="Content-Type" content="…charset=…">`.
 * 허용 목록({@see self::ALIASES})에 있는 문자셋만 변환한다. 목록 밖이거나 판정 불가면 UTF-8 로 보고
 * 변환하지 않는다(깨진 바이트는 호출부의 `mb_scrub` 이 치환한다).
 * 변환은 이미 잘라 둔 `<head>` 구간에만 쓰므로 비용이 작다.
 */
final class LinkPreviewCharset
{
    /** 소문자 이름 => mbstring 인코딩 이름 */
    public const ALIASES = [
        'utf-8' => 'UTF-8',
        'utf8' => 'UTF-8',
        'euc-kr' => 'UHC',
        'euckr' => 'UHC',
        'ks_c_5601-1987' => 'UHC',
        'cp949' => 'UHC',
        'uhc' => 'UHC',
        'windows-949' => 'UHC',
        'shift_jis' => 'SJIS-win',
        'shift-jis' => 'SJIS-win',
        'sjis' => 'SJIS-win',
        'windows-31j' => 'SJIS-win',
        'euc-jp' => 'eucJP-win',
        'gb2312' => 'CP936',
        'gbk' => 'CP936',
        'gb18030' => 'GB18030',
        'big5' => 'BIG-5',
        'iso-8859-1' => 'Windows-1252',
        'latin1' => 'Windows-1252',
        'windows-1252' => 'Windows-1252',
        'us-ascii' => 'UTF-8',
    ];

    /** `<meta>` 를 찾을 앞부분 바이트 */
    private const META_SCAN_BYTES = 4096;

    /**
     * 문자셋을 판정한다.
     *
     * @param  string|null  $contentType  응답 Content-Type 헤더 값
     * @param  string  $html  본문(앞부분이면 충분)
     * @return string mbstring 인코딩 이름 (판정 불가·목록 밖이면 'UTF-8')
     */
    public static function detect(?string $contentType, string $html): string
    {
        $fromHeader = self::charsetParam((string) $contentType);
        if ($fromHeader !== null && isset(self::ALIASES[$fromHeader])) {
            return self::ALIASES[$fromHeader];
        }

        $head = substr($html, 0, self::META_SCAN_BYTES);

        if (preg_match('/<meta\b[^>]*\bcharset\s*=\s*["\']?\s*([A-Za-z0-9_\-:.]+)/i', $head, $m) === 1) {
            $name = strtolower($m[1]);
            if (isset(self::ALIASES[$name])) {
                return self::ALIASES[$name];
            }
        }

        return 'UTF-8';
    }

    /**
     * 문자열을 UTF-8 로 바꾼다. 이미 UTF-8 이면 그대로 돌려준다.
     */
    public static function toUtf8(string $s, string $encoding): string
    {
        if ($s === '' || $encoding === 'UTF-8') {
            return $s;
        }

        if (! in_array($encoding, self::ALIASES, true)) {
            return $s;
        }

        try {
            $out = mb_convert_encoding($s, 'UTF-8', $encoding);
        } catch (\Throwable) {
            return $s;
        }

        return is_string($out) ? $out : $s;
    }

    /**
     * `text/html; charset="EUC-KR"` 같은 값에서 charset 이름(소문자)을 꺼낸다.
     */
    private static function charsetParam(string $contentType): ?string
    {
        if (preg_match('/charset\s*=\s*["\']?\s*([A-Za-z0-9_\-:.]+)/i', $contentType, $m) !== 1) {
            return null;
        }

        return strtolower($m[1]);
    }
}
