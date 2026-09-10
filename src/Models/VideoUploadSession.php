<?php

namespace Plugins\G7\Ckeditor5\Superpack\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * 동영상 청크 업로드 세션 모델.
 *
 * @property int $id
 * @property string $session_key
 * @property string $original_name
 * @property string $mime
 * @property int $total_size
 * @property int $chunk_size
 * @property int $total_chunks
 * @property int $received_count
 * @property string $status uploading|assembling|done|failed
 * @property int|null $uploaded_by
 * @property Carbon $expires_at
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class VideoUploadSession extends Model
{
    protected $table = 'g7_superpack_video_upload_sessions';

    protected $fillable = [
        'session_key',
        'original_name',
        'mime',
        'total_size',
        'chunk_size',
        'total_chunks',
        'received_count',
        'status',
        'uploaded_by',
        'expires_at',
    ];

    protected $casts = [
        'total_size' => 'integer',
        'chunk_size' => 'integer',
        'total_chunks' => 'integer',
        'received_count' => 'integer',
        'expires_at' => 'datetime',
    ];
}
