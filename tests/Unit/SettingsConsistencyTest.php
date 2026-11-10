<?php

namespace Plugins\G7\Ckeditor5\Superpack\Tests\Unit;

require_once dirname(__DIR__).'/PluginTestCase.php';
require_once dirname(__DIR__, 2).'/plugin.php';

use PHPUnit\Framework\TestCase;
use Plugins\G7\Ckeditor5\Superpack\Plugin;

/**
 * 설정 여덟 곳의 일치 (1.7.0) — README "Adding a feature section" 4번.
 *
 *  - plugin.php `getSettingsSchema()` 기본값 = `getConfigValues()` = defaults.json `defaults` = 레이아웃 폼 `schema` 기본값
 *  - 키 집합이 네 곳 모두 같다
 *  - 방문자 노출(`frontend_schema` expose:true)에 새로 더하는 것은 켜짐 여부 6개(글 보기 4·글쓰기 도우미 2)뿐
 *  - 레이아웃에 키마다 입력 칸(같은 name)이 있고, 언어 파일 두 개에 라벨·도움말이 있다
 */
class SettingsConsistencyTest extends TestCase
{
    private const NEW_VIEW_KEYS = ['view_toc_enabled', 'view_lightbox_enabled', 'view_fold_enabled', 'view_readtime_enabled'];

    private const NEW_WRITE_KEYS = ['write_draft_enabled', 'write_count_enabled'];

    /** @return array<string, mixed> */
    private function json(string $rel): array
    {
        return json_decode((string) file_get_contents(dirname(__DIR__, 2).'/'.$rel), true, 512, JSON_THROW_ON_ERROR);
    }

    public function test_defaults_match_in_four_places(): void
    {
        $plugin = new Plugin;
        $schema = $plugin->getSettingsSchema();
        $config = $plugin->getConfigValues();
        $defaults = $this->json('config/settings/defaults.json')['defaults'];
        $layout = $this->json('resources/layouts/admin/plugin_settings.json')['schema'];

        $keys = array_keys($schema);
        sort($keys);
        foreach ([$config, $defaults, $layout] as $i => $set) {
            $k = array_keys($set);
            sort($k);
            $this->assertSame($keys, $k, 'key set #'.$i);
        }

        foreach ($schema as $key => $def) {
            $this->assertSame($def['default'], $config[$key], 'getConfigValues '.$key);
            $this->assertSame($def['default'], $defaults[$key], 'defaults.json '.$key);
            $this->assertSame($def['default'], $layout[$key]['default'], 'layout schema '.$key);
        }
    }

    public function test_new_features_are_off_by_default(): void
    {
        $config = (new Plugin)->getConfigValues();
        foreach (array_merge(self::NEW_VIEW_KEYS, self::NEW_WRITE_KEYS) as $key) {
            $this->assertFalse($config[$key], $key);
        }
    }

    public function test_only_the_six_on_off_keys_are_newly_exposed(): void
    {
        $front = $this->json('config/settings/defaults.json')['frontend_schema'];
        // 1.7.0 에 노출하는 새 키는 켜짐 여부 6개뿐(글 보기 4 + 글쓰기 도우미 2, 윌리엄 결정 F2)
        foreach (array_merge(self::NEW_VIEW_KEYS, self::NEW_WRITE_KEYS) as $key) {
            $this->assertTrue($front[$key]['expose'], $key);
        }
        // 1.6.1 의 비노출 4개는 그대로
        foreach (['linkcard_ttl_ok_days', 'linkcard_ttl_fail_hours', 'video_retention_days', 'imagepaste_webp_enabled'] as $key) {
            $this->assertFalse($front[$key]['expose'], $key);
        }
        $this->assertSame(31 + 6, count(array_filter($front, fn ($v) => $v['expose'] === true)));
        $this->assertSame(35 + 6, count($front));
    }

    public function test_writing_helper_config_endpoint_is_gone(): void
    {
        $root = dirname(__DIR__, 2);
        $this->assertFalse(is_file($root.'/src/Http/Controllers/WriteAssistController.php'));
        $this->assertStringNotContainsString('write-config', (string) file_get_contents($root.'/src/routes/api.php'));
        $this->assertStringNotContainsString('WRITE_CONFIG', (string) file_get_contents($root.'/src/Support/SuperpackRateLimiters.php'));
    }

    public function test_layout_has_an_input_and_both_languages_have_texts_for_new_keys(): void
    {
        $layoutText = (string) file_get_contents(dirname(__DIR__, 2).'/resources/layouts/admin/plugin_settings.json');
        $ko = $this->json('resources/lang/ko.json');
        $en = $this->json('resources/lang/en.json');

        foreach (array_merge(self::NEW_VIEW_KEYS, self::NEW_WRITE_KEYS) as $key) {
            $this->assertStringContainsString('"name": "'.$key.'"', $layoutText, $key);
            foreach (['ko' => $ko, 'en' => $en] as $lang => $data) {
                $this->assertNotNull($data['settings']['fields'][$key]['label'] ?? null, $lang.' label '.$key);
                $this->assertNotNull($data['settings']['fields'][$key]['hint'] ?? null, $lang.' hint '.$key);
            }
        }
        foreach (['ko' => $ko, 'en' => $en] as $lang => $data) {
            $this->assertNotNull($data['settings']['tabs']['view'] ?? null, $lang.' tab view');
            $this->assertNotNull($data['settings']['tabs']['write'] ?? null, $lang.' tab write');
            $this->assertNotNull($data['settings']['view']['intro'] ?? null, $lang.' view intro');
            $this->assertNotNull($data['settings']['write']['intro'] ?? null, $lang.' write intro');
        }
        $this->assertStringContainsString('"id": "tab_btn_view"', $layoutText);
        $this->assertStringContainsString('"id": "tab_btn_write"', $layoutText);
        $this->assertStringContainsString('"id": "panel_view"', $layoutText);
        $this->assertStringContainsString('"id": "panel_write"', $layoutText);
    }

    public function test_fold_hint_says_markers_show_when_off(): void
    {
        $ko = $this->json('resources/lang/ko.json');
        $this->assertStringContainsString('끄면 기존 글에 표식 글자가 그대로 보입니다', $ko['settings']['fields']['view_fold_enabled']['hint']);
        $hint = (new Plugin)->getSettingsSchema()['view_fold_enabled']['hint']['ko'];
        $this->assertStringContainsString('끄면 기존 글에 표식 글자가 그대로 보입니다', $hint);
    }
}
