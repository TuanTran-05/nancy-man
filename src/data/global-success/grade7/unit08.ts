import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g7-u8-films',
  curriculumFamily: 'global-success',
  grade: 7,
  unitNumber: 8,
  title: 'Grammar Grade 7 - Unit 8: Films',
  description:
    'Bài giảng Unit 8 Global Success 7 về Although, Though, However và từ vựng chủ đề Films.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 7',
      subtitle: 'UNIT 8: FILMS',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'ALTHOUGH / THOUGH',
          subtitle: '(Mặc dù)',
          accent: 'orange',
        },
        {
          title: 'HOWEVER',
          subtitle: '(Tuy nhiên)',
          accent: 'pink',
        },
        {
          title: 'FILM VOCABULARY',
          subtitle: '(Từ vựng phim ảnh)',
          accent: 'blue',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      bullets: [
        { content: 'Dùng although / though để nối hai ý trái ngược trong một câu.' },
        { content: 'Dùng however để nối hai câu hoặc hai ý trái ngược.' },
        { content: 'Phân biệt dấu câu khi dùng although / though và however.' },
        { content: 'Nhận xét phim bằng từ vựng về thể loại, nhân vật, cốt truyện và cảm xúc.' },
      ],
    },
    {
      id: 's3',
      title: 'Phần 1',
      subtitle: 'Although / Though',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Although / Though là gì?',
      subtitle: 'Hai liên từ dùng để nối hai ý trái ngược nhau trong cùng một câu.',
      layout: 'explain',
      accent: 'orange',
      formula: 'Although / Though + S + V, S + V.',
      bullets: [
        { content: 'Cả although và though đều có nghĩa là mặc dù.' },
        { content: 'Dùng khi một ý trái ngược hoặc bất ngờ so với ý còn lại.' },
        { content: 'Trong chủ đề Films, dùng để nhận xét điểm tốt và chưa tốt của phim.' },
      ],
      examples: [
        'Although the film was long, I enjoyed it.',
        'Though the story was simple, the acting was excellent.',
        'Although the ending was sad, the film was meaningful.',
      ],
    },
    {
      id: 's5',
      title: 'Đứng đầu câu',
      subtitle: 'Khi although / though đứng đầu câu, dùng dấu phẩy giữa hai mệnh đề.',
      layout: 'explain',
      accent: 'orange',
      formula: 'Although / Though + S + V, S + V.',
      bullets: [
        { content: 'Mệnh đề although / though đứng trước.' },
        { content: 'Mệnh đề chính đứng sau dấu phẩy.' },
        { content: 'Hai mệnh đề đều cần có chủ ngữ và động từ.' },
      ],
      examples: [
        'Although the film was boring, I watched it until the end.',
        'Though the cinema was crowded, we found good seats.',
        'Although the actor was young, he acted very well.',
      ],
    },
    {
      id: 's6',
      title: 'Đứng giữa câu',
      subtitle: 'Khi although / though đứng giữa câu, thường không cần dấu phẩy.',
      layout: 'explain',
      accent: 'blue',
      formula: 'S + V + although / though + S + V.',
      bullets: [
        { content: 'Mệnh đề chính đứng trước.' },
        { content: 'Although / though nối với ý trái ngược phía sau.' },
        { content: 'Cách này thường dùng trong câu nhận xét phim ngắn gọn.' },
      ],
      examples: [
        'I enjoyed the film although it was very long.',
        'She liked the ending though it was sad.',
        'They watched the film although they were tired.',
      ],
    },
    {
      id: 's7',
      title: 'Although hay Though?',
      subtitle: 'Hai từ gần như giống nhau về nghĩa, nhưng sắc thái hơi khác.',
      layout: 'cards',
      cards: [
        {
          title: 'Although',
          accent: 'orange',
          content: 'Trang trọng hơn, thường dùng trong văn viết.',
          example: 'Although the film was long, it was interesting.',
        },
        {
          title: 'Though',
          accent: 'blue',
          content: 'Tự nhiên hơn, thường dùng trong văn nói.',
          example: 'Though the film was long, it was interesting.',
        },
        {
          title: 'Ghi nhớ',
          accent: 'green',
          content: 'Ở lớp 7, hai từ này thường có thể thay thế cho nhau.',
          example: 'Although / Though the story was simple, it was good.',
        },
      ],
    },
    {
      id: 's8',
      title: 'Dùng trong chủ đề Films',
      subtitle: 'Nói về cảm nhận trái chiều khi xem phim.',
      layout: 'cards',
      cards: [
        {
          title: 'Điểm chưa tốt',
          accent: 'orange',
          content: 'Phim có điểm hạn chế nhưng vẫn đáng xem.',
          example: 'Although the film was long, it was exciting.',
        },
        {
          title: 'Diễn viên',
          accent: 'blue',
          content: 'Nhận xét diễn viên hoặc nhân vật.',
          example: 'Though the actor was young, he acted very well.',
        },
        {
          title: 'Trải nghiệm',
          accent: 'pink',
          content: 'Nói về hoàn cảnh xem phim.',
          example: 'Although the cinema was crowded, we enjoyed the film.',
        },
      ],
    },
    {
      id: 's9',
      title: 'Lưu ý với Although / Though',
      subtitle: 'Ba lỗi cần tránh khi viết câu.',
      layout: 'cards',
      cards: [
        {
          title: 'Không dùng but',
          accent: 'pink',
          content: 'Không dùng but trong cùng câu với although / though.',
          example: 'Although the film was boring, I watched it.',
        },
        {
          title: 'Sau although là mệnh đề',
          accent: 'orange',
          content: 'Although / though + S + V.',
          example: 'Although the film was long, I liked it.',
        },
        {
          title: 'Khác despite',
          accent: 'blue',
          content: 'Although + S + V; despite + noun / V-ing.',
          example: 'Although the story was simple, the acting was good.',
        },
      ],
    },
    {
      id: 's10',
      title: 'Ví dụ Although / Though',
      subtitle: 'Nhìn hai ý trái ngược trong cùng một câu.',
      layout: 'cards',
      cards: [
        {
          title: 'Scary but enjoyable',
          accent: 'orange',
          content: 'Bộ phim đáng sợ nhưng người xem vẫn thích.',
          example: 'Although the film was scary, I enjoyed it.',
        },
        {
          title: 'Sad but meaningful',
          accent: 'pink',
          content: 'Kết thúc buồn nhưng bộ phim có ý nghĩa.',
          example: 'Though the ending was sad, the film was meaningful.',
        },
        {
          title: 'Not famous but good',
          accent: 'blue',
          content: 'Diễn viên không nổi tiếng nhưng diễn tốt.',
          example: 'Although the actors were not famous, they acted very well.',
        },
      ],
    },
    {
      id: 's11',
      title: 'Phần 2',
      subtitle: 'However',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's12',
      title: 'However là gì?',
      subtitle: 'Trạng từ liên kết dùng để đưa ra ý trái ngược với câu trước.',
      layout: 'explain',
      accent: 'pink',
      formula: 'Sentence 1. However, sentence 2.',
      bullets: [
        { content: 'However có nghĩa là tuy nhiên / thế nhưng.' },
        { content: 'Thường đứng đầu câu thứ hai.' },
        { content: 'Khi đứng đầu câu, có dấu chấm trước và dấu phẩy sau however.' },
      ],
      examples: [
        'The film was long. However, it was very interesting.',
        'The acting was good. However, the story was boring.',
        'I like action films. However, I don’t like violent scenes.',
      ],
    },
    {
      id: 's13',
      title: 'However đầu câu thứ hai',
      subtitle: 'Cách dùng phổ biến nhất cho học sinh lớp 7.',
      layout: 'cards',
      cards: [
        {
          title: 'Dấu câu',
          accent: 'pink',
          content: 'Sentence 1. However, sentence 2.',
          example: 'The film was boring. However, many people liked it.',
        },
        {
          title: 'Ý trái ngược',
          accent: 'orange',
          content: 'Câu sau trái với hoặc bổ sung góc nhìn khác cho câu trước.',
          example: 'The story was simple. However, the acting was excellent.',
        },
        {
          title: 'Nhận xét phim',
          accent: 'blue',
          content: 'Dùng để nêu điểm tốt và điểm chưa tốt.',
          example: 'The plot was weak. However, the music was wonderful.',
        },
      ],
    },
    {
      id: 's14',
      title: 'However giữa câu',
      subtitle: 'Cách này trang trọng hơn và ít dùng hơn ở lớp 7.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Sentence 1. S, however, V ...',
      bullets: [
        { content: 'However có thể đứng giữa câu thứ hai.' },
        { content: 'Cần dùng dấu phẩy trước và sau however.' },
        { content: 'Khi luyện cơ bản, ưu tiên dùng however đầu câu thứ hai.' },
      ],
      examples: [
        'The film was long. I, however, enjoyed it.',
        'The story was simple. The actors, however, performed very well.',
      ],
    },
    {
      id: 's15',
      title: 'Although / Though vs However',
      subtitle: 'Cùng nói ý trái ngược, nhưng cấu trúc và dấu câu khác nhau.',
      layout: 'cards',
      cards: [
        {
          title: 'Although / Though',
          accent: 'orange',
          content: 'Liên từ, nối hai ý trong một câu.',
          example: 'Although the film was long, I liked it.',
        },
        {
          title: 'However',
          accent: 'pink',
          content: 'Trạng từ liên kết, thường nối hai câu riêng.',
          example: 'The film was long. However, I liked it.',
        },
        {
          title: 'Dấu câu',
          accent: 'blue',
          content: 'Although đầu câu dùng dấu phẩy; however đầu câu hai dùng dấu chấm và dấu phẩy.',
          example: 'Sentence 1. However, sentence 2.',
        },
      ],
    },
    {
      id: 's16',
      title: 'Chuyển đổi câu',
      subtitle: 'Viết lại từ although sang however và ngược lại.',
      layout: 'cards',
      cards: [
        {
          title: 'Although → However',
          accent: 'orange',
          content: 'Although the film was boring, I watched it until the end.',
          example: 'The film was boring. However, I watched it until the end.',
        },
        {
          title: 'However → Although',
          accent: 'pink',
          content: 'The story was simple. However, the acting was excellent.',
          example: 'Although the story was simple, the acting was excellent.',
        },
      ],
    },
    {
      id: 's17',
      title: 'Lưu ý với However',
      subtitle: 'Ba lỗi dấu câu cần tránh.',
      layout: 'cards',
      cards: [
        {
          title: 'Không đứng sau although',
          accent: 'pink',
          content: 'Không dùng Although... However... cho cùng ý.',
          example: 'The film was boring. However, I liked it.',
        },
        {
          title: 'Cần tách câu',
          accent: 'orange',
          content: 'Không viết liền hai mệnh đề với however ở giữa.',
          example: 'The film was long. However, it was interesting.',
        },
        {
          title: 'Có dấu phẩy',
          accent: 'blue',
          content: 'Sau However ở đầu câu thường có dấu phẩy.',
          example: 'However, it was interesting.',
        },
      ],
    },
    {
      id: 's18',
      title: 'Ví dụ However',
      subtitle: 'Dùng however để đưa ra nhận xét trái chiều về phim.',
      layout: 'cards',
      cards: [
        {
          title: 'Scary',
          accent: 'pink',
          content: 'Câu sau trái với cảm giác đáng sợ.',
          example: 'The film was scary. However, I enjoyed it.',
        },
        {
          title: 'Famous actors',
          accent: 'orange',
          content: 'Diễn viên nổi tiếng nhưng phim không thành công.',
          example: 'The actors were famous. However, the film was not successful.',
        },
        {
          title: 'Music',
          accent: 'blue',
          content: 'Cốt truyện chưa tốt nhưng âm nhạc hay.',
          example: 'The story was boring. However, the music was wonderful.',
        },
      ],
    },
    {
      id: 's19',
      title: 'Phần 3',
      subtitle: 'Films Vocabulary',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's20',
      title: 'Các thể loại phim',
      subtitle: 'Từ vựng trọng tâm về film genres.',
      layout: 'cards',
      cards: [
        {
          title: 'Funny / light',
          accent: 'green',
          bullets: ['comedy', 'cartoon', 'animation'],
        },
        {
          title: 'Exciting',
          accent: 'orange',
          bullets: ['action film', 'thriller', 'fantasy film'],
        },
        {
          title: 'Serious',
          accent: 'blue',
          bullets: ['documentary', 'science fiction film'],
        },
        {
          title: 'Emotional',
          accent: 'pink',
          bullets: ['romantic film', 'horror film'],
        },
      ],
    },
    {
      id: 's21',
      title: 'Người trong phim',
      subtitle: 'Từ vựng về nhân vật và người làm phim.',
      layout: 'cards',
      cards: [
        {
          title: 'Actors',
          accent: 'orange',
          bullets: ['actor', 'actress', 'film star'],
        },
        {
          title: 'Characters',
          accent: 'blue',
          bullets: ['character', 'main character', 'hero', 'villain'],
        },
        {
          title: 'Film makers',
          accent: 'green',
          bullets: ['director', 'audience'],
        },
        {
          title: 'Example',
          accent: 'pink',
          bullets: ['The main character is brave.', 'The actor acted very well.'],
        },
      ],
    },
    {
      id: 's22',
      title: 'Yếu tố trong phim',
      subtitle: 'Dùng để nhận xét một bộ phim chi tiết hơn.',
      layout: 'cards',
      cards: [
        {
          title: 'Story',
          accent: 'orange',
          bullets: ['plot', 'story', 'ending', 'scene'],
        },
        {
          title: 'Sound & image',
          accent: 'blue',
          bullets: ['music', 'sound', 'special effects'],
        },
        {
          title: 'Performance',
          accent: 'green',
          bullets: ['acting', 'excellent acting'],
        },
        {
          title: 'Cinema',
          accent: 'pink',
          bullets: ['ticket', 'cinema', 'audience'],
        },
      ],
    },
    {
      id: 's23',
      title: 'Tính từ miêu tả phim',
      subtitle: 'Từ vựng giúp nói cảm nhận sau khi xem phim.',
      layout: 'cards',
      cards: [
        {
          title: 'Positive',
          accent: 'green',
          bullets: ['interesting', 'funny', 'exciting', 'amazing'],
        },
        {
          title: 'Emotional',
          accent: 'pink',
          bullets: ['moving', 'sad', 'scary'],
        },
        {
          title: 'Negative',
          accent: 'orange',
          bullets: ['boring', 'violent', 'disappointing'],
        },
        {
          title: 'Quality',
          accent: 'blue',
          bullets: ['excellent', 'popular', 'meaningful'],
        },
      ],
    },
    {
      id: 's24',
      title: 'Cấu trúc giao tiếp',
      subtitle: 'Ba mẫu câu thường dùng khi nói về phim.',
      layout: 'cards',
      cards: [
        {
          title: 'Thể loại yêu thích',
          accent: 'green',
          content: 'I like + film genre + because + S + V.',
          example: 'I like comedies because they are funny.',
        },
        {
          title: 'Nhận xét với although',
          accent: 'orange',
          content: 'Although / Though + S + V, S + V.',
          example: 'Although the film was long, I enjoyed it.',
        },
        {
          title: 'Nhận xét với however',
          accent: 'pink',
          content: 'Sentence 1. However, sentence 2.',
          example: 'The plot was weak. However, the special effects were amazing.',
        },
      ],
    },
    {
      id: 's25',
      title: 'Luyện tập nhanh',
      subtitle: 'Chọn although, though hoặc however.',
      layout: 'practice',
      accent: 'orange',
      bullets: [
        { content: '_____ the film was long, I enjoyed it.' },
        { content: 'The story was simple. _____, the acting was excellent.' },
        { content: 'I liked the film _____ it was a bit scary.' },
        { content: '_____ the tickets were expensive, many people watched the movie.' },
      ],
      examples: ['Although', 'However', 'although / though', 'Although / Though'],
    },
    {
      id: 's26',
      title: 'Unit 8 Recap',
      subtitle: 'Films',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Although / though là liên từ, nối hai ý trái ngược trong một câu.' },
        { content: 'Khi although / though đứng đầu câu, dùng dấu phẩy giữa hai mệnh đề.' },
        { content: 'However là trạng từ liên kết, thường đứng đầu câu thứ hai.' },
        {
          content:
            'Khi viết review phim, dùng các từ về genre, plot, acting, ending và adjectives.',
        },
      ],
      examples: [
        'Although the film was long, it was interesting.',
        'The film was long. However, it was interesting.',
        'I like action films because they are exciting.',
      ],
    },
  ],
};

export default deck;
