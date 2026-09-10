<?php

namespace Plugins\G7\Ckeditor5\Superpack\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * 완성된 동영상 업로드 파일 메타 모델.
 *
 * @property int $id
 * @property string $public_id 공개 조회 키 (URL 노출, 추측 불가)
 * @property string $original_name
 * @property string $mime
 * @property int $size
 * @property string $storage_disk
 * @property string $storage_path 카테고리 포함 상대 경로 (예: "videos/2026/09/uuid.mp4")
 * @property int|null $uploaded_by
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class VideoUpload extends Model
{
    protected $table = 'g7_superpack_video_uploads';

    protected $fillable = [
        'public_id',
        'original_name',
        'mime',
        'size',
        'storage_disk',
        'storage_path',
        'uploaded_by',
    ];

    protected $casts = [
        'size' => 'integer',
    ];
}
