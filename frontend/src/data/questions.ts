import { mapApiTicketToRefQuestion, type RefAttachment, type RefQuestion, type RefThreadMessage, type RefPriority, type RefQuestionStatus } from "@/lib/mappers";
import type { ApiTicket } from "@/lib/types";

import { bumpDataVersion } from "./_bridge";

export type QuestionStatus = RefQuestionStatus;
export type Priority = RefPriority;
export type ThreadMessage = RefThreadMessage;
export type Attachment = RefAttachment;
export type Question = RefQuestion;

let _questions: Question[] = [];
let _questionsTotal = 0;

export function setQuestions(api: ApiTicket[], options?: { bump?: boolean }): void {
  _questions = api.map(mapApiTicketToRefQuestion);
  _questionsTotal = _questions.length;
  if (options?.bump !== false) bumpDataVersion();
}

export function setQuestionsPage(api: ApiTicket[], total: number, options?: { bump?: boolean }): void {
  _questions = api.map(mapApiTicketToRefQuestion);
  _questionsTotal = Math.max(total, _questions.length);
  if (options?.bump !== false) bumpDataVersion();
}

export function getQuestions(): Question[] {
  return _questions;
}

export function getQuestionsTotal(): number {
  return _questionsTotal;
}

export const questions = new Proxy<Question[]>([], {
  get(_target, prop, receiver) {
    return Reflect.get(_questions, prop, receiver) ?? Reflect.get([], prop);
  },
  has(_target, prop) {
    return prop in _questions;
  },
  ownKeys() {
    return Reflect.ownKeys(_questions);
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(_questions, prop);
  },
});
