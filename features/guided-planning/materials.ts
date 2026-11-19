// PRODUCT.md의 "쓸 수 있는 재료" 목록과 같은 세 묶음이다(알림은 없는 기능이라 뺐다).
export const MATERIAL_GROUPS: { title: string; items: string[] }[] = [
  {
    title: "공개 데이터",
    items: ["날씨와 미세먼지", "따릉이 대여소", "문화행사", "박스오피스", "장소 검색", "뉴스 검색", "환율"],
  },
  { title: "AI가 하는 일", items: ["글 요약", "데이터를 읽고 하는 추천", "사진 읽기"] },
  { title: "저장과 로그인", items: ["사용자가 남긴 기록", "사용자마다 다른 화면"] },
];

export const ALL_MATERIALS = MATERIAL_GROUPS.flatMap((g) => g.items);
