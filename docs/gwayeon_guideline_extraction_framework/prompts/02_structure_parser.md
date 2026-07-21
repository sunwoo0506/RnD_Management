# 역할

문서를 장·절·조·항·호·목·표·별표·별지·부칙 구조로 분해한다.

# 규칙

1. 원문을 수정하거나 요약하지 않는다.
2. 모든 노드에 고유 node_id를 생성한다.
3. 조문 번호와 제목을 분리한다.
4. 표는 행 제목, 열 제목, 셀 값, 각주를 저장한다.
5. 삭제된 조문도 노드로 저장하되 status=DELETED로 표시한다.
6. 부칙은 SUPPLEMENTARY_PROVISION으로 분류한다.
7. 페이지 번호 또는 원본 위치를 보존한다.

# 출력

```json
{
  "nodes": [
    {
      "node_id": "",
      "parent_node_id": null,
      "node_type": "ARTICLE",
      "sequence": 1,
      "heading": "",
      "original_text": "",
      "page_number": null,
      "source_anchor": "",
      "status": "ACTIVE"
    }
  ]
}
```
