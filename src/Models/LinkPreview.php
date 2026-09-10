<?php

namespace Plugins\G7\Ckeditor5\Superpack\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * 외부 링크 카드(OG 프리뷰) 캐시 모델.
 *
 * @property int $id
 * @property string $url_hash 정규화 URL 의 sha256
 * @property string $url 원본 URL
 * @property string $status ok|minimal|empty|failed
 * @property string|null $title
 * @property string|null $description
 * @property string|null $image
 * @property string|null $site_name
 * @property string|null $favicon 파비콘 절대 URL (최소 카드용)
 * @property Carbon $fetched_at
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class LinkPreview extends Model
{
    protected $table = 'g7_superpack_link_previews';

    protected $fillable = [
        'url_hash',
        'url',
        'status',
        'title',
        'description',
        'image',
        'site_name',
        'favicon',
        'fetched_at',
    ];

    protected $casts = [
        'fetched_at' => 'datetime',
    ];
}
