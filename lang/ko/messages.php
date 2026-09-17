<?php

return [
    'video' => [
        'err_disabled' => '로컬 동영상 업로드 기능이 꺼져 있습니다.',
        'err_ext' => ':exts 형식의 동영상 파일만 업로드할 수 있습니다.',
        'err_mime' => '동영상 파일이 아닙니다.',
        'err_size' => '파일 크기가 허용 용량(:max MB)을 초과합니다.',
        'err_session' => '업로드 세션이 만료되었거나 유효하지 않습니다. 다시 시도해 주세요.',
        'err_incomplete' => '일부 청크가 도착하지 않았습니다. 업로드를 다시 시도해 주세요.',
        'err_signature' => 'MP4 동영상 파일이 아닙니다. (파일 형식 검증 실패)',
        'err_generic' => '동영상 업로드 처리 중 오류가 발생했습니다.',
    ],
    'link_preview' => [
        'prune_done' => '링크 카드 캐시 정리 완료 — 만료 :expired건, 상한(:max건) 초과 :overflow건 삭제, 남은 행 :remaining건.',
        'prune_dry_run' => '[dry-run] 삭제 대상 — 만료 :expired건, 상한(:max건) 초과 :overflow건. 정리 후 남을 행 :remaining건. 실제로 지우지 않았습니다.',
    ],
];
