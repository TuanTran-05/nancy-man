import { useEffect } from 'react';

let lockCount = 0;
let windowScrollX = 0;
let windowScrollY = 0;
let originalBodyOverflow = '';
let originalBodyPaddingRight = '';
let originalBodyPosition = '';
let originalBodyTop = '';
let originalBodyLeft = '';
let originalBodyRight = '';
let originalBodyWidth = '';
let originalHtmlOverflow = '';
let originalHtmlOverscrollBehavior = '';
let lockedScrollContainers: {
  element: HTMLElement;
  overflow: string;
  overscrollBehavior: string;
}[] = [];

export function useBodyScrollLock(isLocked: boolean) {
  useEffect(() => {
    if (!isLocked) return;

    lockCount++;

    if (lockCount === 1) {
      windowScrollX = window.scrollX;
      windowScrollY = window.scrollY;

      originalBodyOverflow = document.body.style.overflow;
      originalBodyPaddingRight = document.body.style.paddingRight;
      originalBodyPosition = document.body.style.position;
      originalBodyTop = document.body.style.top;
      originalBodyLeft = document.body.style.left;
      originalBodyRight = document.body.style.right;
      originalBodyWidth = document.body.style.width;
      originalHtmlOverflow = document.documentElement.style.overflow;
      originalHtmlOverscrollBehavior = document.documentElement.style.overscrollBehavior;

      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.documentElement.style.overflow = 'hidden';
      document.documentElement.style.overscrollBehavior = 'none';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${windowScrollY}px`;
      document.body.style.left = `-${windowScrollX}px`;
      document.body.style.right = '0';
      document.body.style.width = '100%';
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }

      lockedScrollContainers = Array.from(
        document.querySelectorAll<HTMLElement>('[data-scroll-lock-container]')
      ).map((element) => {
        const styles = {
          element,
          overflow: element.style.overflow,
          overscrollBehavior: element.style.overscrollBehavior,
        };

        element.style.overflow = 'hidden';
        element.style.overscrollBehavior = 'contain';

        return styles;
      });
    }

    return () => {
      lockCount--;
      if (lockCount === 0) {
        document.documentElement.style.overflow = originalHtmlOverflow;
        document.documentElement.style.overscrollBehavior = originalHtmlOverscrollBehavior;
        document.body.style.overflow = originalBodyOverflow;
        document.body.style.paddingRight = originalBodyPaddingRight;
        document.body.style.position = originalBodyPosition;
        document.body.style.top = originalBodyTop;
        document.body.style.left = originalBodyLeft;
        document.body.style.right = originalBodyRight;
        document.body.style.width = originalBodyWidth;

        lockedScrollContainers.forEach(({ element, overflow, overscrollBehavior }) => {
          element.style.overflow = overflow;
          element.style.overscrollBehavior = overscrollBehavior;
        });
        lockedScrollContainers = [];

        window.scrollTo(windowScrollX, windowScrollY);
      }
    };
  }, [isLocked]);
}
