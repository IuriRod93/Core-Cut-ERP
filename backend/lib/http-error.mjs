/** Erro com status HTTP, devolvido ao cliente com a mensagem em `error`. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
