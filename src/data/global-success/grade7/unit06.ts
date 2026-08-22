import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g7-u6-school-visit',
  curriculumFamily: 'global-success',
  grade: 7,
  unitNumber: 6,
  title: 'Grammar Grade 7 - Unit 6: A Visit to a School',
  description:
    'Bài giảng Unit 6 Global Success 7 về prepositions of time, prepositions of place và từ vựng A Visit to a School.',
  createdAt: '2026-05-17T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 7',
      subtitle: 'UNIT 6: A VISIT TO A SCHOOL',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'PREPOSITIONS OF TIME',
          subtitle: '(Giới từ chỉ thời gian)',
          accent: 'orange',
        },
        {
          title: 'PREPOSITIONS OF PLACE',
          subtitle: '(Giới từ chỉ nơi chốn)',
          accent: 'pink',
        },
        {
          title: 'IN / ON / AT',
          subtitle: '(So sánh cách dùng)',
          accent: 'blue',
        },
        {
          title: 'SCHOOL VISIT',
          subtitle: '(Từ vựng và giao tiếp)',
          accent: 'green',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      accent: 'blue',
      bullets: [
        {
          content:
            'Dùng đúng in, on, at khi nói về thời gian học, lịch tham quan và thời khóa biểu.',
        },
        {
          content:
            'Dùng giới từ nơi chốn để mô tả vị trí phòng học, thư viện, sân trường và đồ vật.',
        },
        {
          content:
            'Phân biệt các cặp dễ nhầm như in / on / at, next to / near, in front of / opposite.',
        },
        {
          content: 'Hỏi và trả lời về thời gian, vị trí trong ngữ cảnh thăm trường học.',
        },
      ],
    },
    {
      id: 's3',
      title: 'PREPOSITIONS OF TIME',
      subtitle: 'Giới từ chỉ thời gian',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'In, On, At với thời gian',
      subtitle: 'Ba giới từ chính cho ba mức độ cụ thể khác nhau.',
      layout: 'cards',
      cards: [
        {
          title: 'IN',
          accent: 'orange',
          bullets: ['tháng', 'năm', 'mùa', 'buổi trong ngày'],
          example: 'in September, in the morning',
        },
        {
          title: 'ON',
          accent: 'pink',
          bullets: ['thứ', 'ngày cụ thể', 'ngày lễ có day'],
          example: 'on Monday, on Teachers Day',
        },
        {
          title: 'AT',
          accent: 'blue',
          bullets: ['giờ cụ thể', 'thời điểm chính xác', 'cụm cố định'],
          example: 'at 7 a.m., at noon',
        },
      ],
    },
    {
      id: 's5',
      title: 'Dùng In',
      subtitle: 'In bao phủ một khoảng thời gian rộng.',
      layout: 'cards',
      cards: [
        {
          title: 'Tháng / năm',
          accent: 'orange',
          bullets: ['in January', 'in 2025'],
        },
        {
          title: 'Mùa / buổi',
          accent: 'green',
          bullets: ['in summer', 'in the afternoon'],
        },
        {
          title: 'Ví dụ',
          accent: 'blue',
          bullets: [
            'Our school year starts in September.',
            'Students play sports in the afternoon.',
          ],
        },
      ],
    },
    {
      id: 's6',
      title: 'Dùng On và At',
      subtitle: 'On cho ngày cụ thể; at cho thời điểm chính xác.',
      layout: 'cards',
      cards: [
        {
          title: 'ON',
          accent: 'pink',
          bullets: ['on Monday', 'on 20 November', 'on Monday morning'],
        },
        {
          title: 'AT',
          accent: 'blue',
          bullets: ['at 7 a.m.', 'at noon', 'at break time'],
        },
        {
          title: 'Ví dụ',
          accent: 'green',
          bullets: ['We have music on Tuesday.', 'Classes start at 7 a.m.'],
        },
      ],
    },
    {
      id: 's7',
      title: 'Các giới từ thời gian khác',
      subtitle: 'Dùng để nói trước, sau, trong suốt hoặc kéo dài bao lâu.',
      layout: 'cards',
      cards: [
        {
          title: 'Trước / sau',
          accent: 'orange',
          bullets: ['before', 'after'],
        },
        {
          title: 'Khoảng thời gian',
          accent: 'pink',
          bullets: ['during', 'for', 'until / till'],
        },
        {
          title: 'Khoảng bắt đầu - kết thúc',
          accent: 'blue',
          bullets: ['from ... to ...', 'by'],
        },
        {
          title: 'Ví dụ',
          accent: 'green',
          bullets: ['We play football after school.', 'The lesson is from 8 to 9.'],
        },
      ],
    },
    {
      id: 's8',
      title: 'Lưu ý về thời gian',
      subtitle: 'Không phải lúc nào cũng cần giới từ.',
      layout: 'cards',
      cards: [
        {
          title: 'Không dùng trước...',
          accent: 'red',
          bullets: ['this', 'last', 'next', 'every'],
        },
        {
          title: 'Morning',
          accent: 'orange',
          bullets: ['in the morning', 'on Monday morning'],
        },
        {
          title: 'Evening / night',
          accent: 'blue',
          bullets: ['in the evening', 'at night'],
        },
      ],
    },
    {
      id: 's9',
      title: 'PREPOSITIONS OF PLACE',
      subtitle: 'Giới từ chỉ nơi chốn',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's10',
      title: 'In, On, At với nơi chốn',
      subtitle: 'Cùng ba từ, nhưng nghĩa chuyển sang vị trí.',
      layout: 'cards',
      cards: [
        {
          title: 'IN',
          accent: 'orange',
          bullets: ['bên trong không gian', 'in the classroom', 'in the library'],
        },
        {
          title: 'ON',
          accent: 'pink',
          bullets: ['trên bề mặt', 'on the desk', 'on the wall'],
        },
        {
          title: 'AT',
          accent: 'blue',
          bullets: ['tại địa điểm cụ thể', 'at school', 'at the gate'],
        },
      ],
    },
    {
      id: 's11',
      title: 'Các giới từ vị trí khác',
      subtitle: 'Dùng để mô tả sơ đồ trường học.',
      layout: 'cards',
      cards: [
        {
          title: 'Gần / cạnh',
          accent: 'green',
          bullets: ['next to', 'beside', 'near'],
        },
        {
          title: 'Trước / sau',
          accent: 'orange',
          bullets: ['in front of', 'behind', 'opposite'],
        },
        {
          title: 'Giữa / trên / dưới',
          accent: 'blue',
          bullets: ['between', 'under', 'above'],
        },
        {
          title: 'Hướng',
          accent: 'purple',
          bullets: ['on the left of', 'on the right of', 'outside'],
        },
      ],
    },
    {
      id: 's12',
      title: 'Mẫu câu vị trí',
      subtitle: 'Dùng be, there is / there are và câu hỏi Where.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'Với be',
          accent: 'blue',
          content: 'S + be + preposition + place',
          example: 'The library is next to the lab.',
        },
        {
          title: 'There is / There are',
          accent: 'green',
          bullets: [
            'There is + singular noun + preposition + place.',
            'There are + plural noun + preposition + place.',
          ],
          example: 'There are students in the classroom.',
        },
        {
          title: 'Where',
          accent: 'orange',
          content: 'Where + be + S?',
          example: 'Where is the library?',
        },
      ],
    },
    {
      id: 's13',
      title: 'Các cặp dễ nhầm',
      subtitle: 'Nhìn quan hệ không gian trước khi chọn giới từ.',
      layout: 'cards',
      cards: [
        {
          title: 'In front of / Opposite',
          accent: 'orange',
          bullets: ['cùng phía phía trước', 'đối diện bên kia'],
        },
        {
          title: 'Next to / Near',
          accent: 'pink',
          bullets: ['ngay sát cạnh', 'gần nhưng không sát'],
        },
        {
          title: 'Between / Among',
          accent: 'blue',
          bullets: ['giữa 2 vật', 'giữa nhiều vật'],
        },
      ],
    },
    {
      id: 's14',
      title: 'Lỗi thường gặp với nơi chốn',
      subtitle: 'Chọn theo nghĩa, không chỉ theo thói quen dịch.',
      layout: 'cards',
      cards: [
        {
          title: 'Ở trong phòng',
          accent: 'red',
          bullets: ['Sai: on the classroom', 'Đúng: in the classroom'],
        },
        {
          title: 'At school / In a school',
          accent: 'orange',
          bullets: ['at school = đang ở trường', 'in a school = trong một ngôi trường'],
        },
        {
          title: 'Sau giới từ',
          accent: 'blue',
          bullets: ['thường là danh từ hoặc cụm danh từ'],
        },
      ],
    },
    {
      id: 's15',
      title: 'A VISIT TO A SCHOOL',
      subtitle: 'Từ vựng chủ đề thăm trường học',
      label: 'Phần 3',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's16',
      title: 'School Vocabulary',
      subtitle: 'Những nhóm từ quan trọng trong Unit 6.',
      layout: 'cards',
      cards: [
        {
          title: 'Places',
          accent: 'orange',
          bullets: ['classroom', 'library', 'lab', 'computer room'],
        },
        {
          title: 'More places',
          accent: 'pink',
          bullets: ['playground', 'canteen', 'gym', 'school gate'],
        },
        {
          title: 'Activities',
          accent: 'blue',
          bullets: ['study', 'visit', 'do experiments', 'join a club'],
        },
        {
          title: 'Objects',
          accent: 'green',
          bullets: ['desk', 'board', 'clock', 'notice board'],
        },
      ],
    },
    {
      id: 's17',
      title: 'Giao tiếp thường gặp',
      subtitle: 'Hỏi thời gian và vị trí khi tham quan trường.',
      layout: 'explain',
      accent: 'purple',
      sections: [
        {
          title: 'Hỏi vị trí',
          accent: 'orange',
          content: 'Where is / are + place?',
          example: 'Where is the library?',
        },
        {
          title: 'Hỏi thời gian',
          accent: 'pink',
          content: 'When / What time + do/does + S + V?',
          example: 'What time does the school visit start?',
        },
        {
          title: 'Miêu tả đồ vật',
          accent: 'blue',
          content: 'There is / There are + noun + preposition + place',
          example: 'There is a clock above the board.',
        },
      ],
    },
    {
      id: 's18',
      title: 'Luyện tập nhanh',
      subtitle: 'Chọn giới từ phù hợp.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: 'We have English _____ Monday.' },
        { content: 'The school visit starts _____ 8 a.m.' },
        { content: 'Students are _____ the classroom.' },
        { content: 'The library is _____ the computer room.' },
      ],
      examples: ['on', 'at', 'in', 'next to'],
    },
    {
      id: 's19',
      title: 'Unit 6 Recap',
      subtitle: 'A Visit to a School',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Time: in cho khoảng rộng, on cho ngày, at cho thời điểm chính xác.' },
        { content: 'Place: in cho bên trong, on cho bề mặt, at cho địa điểm cụ thể.' },
        { content: 'Where is/are...? dùng để hỏi vị trí trong trường.' },
        { content: 'Từ vựng trường học giúp mô tả chuyến tham quan rõ ràng hơn.' },
      ],
      examples: [
        'We visit the school on Monday.',
        'The timetable is on the notice board.',
        'The playground is behind the school building.',
      ],
    },
  ],
};

export default deck;
