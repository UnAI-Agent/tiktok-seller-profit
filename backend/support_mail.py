"""Forward a support ticket to the owner's inbox. Uses the Python standard library."""

from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage

logger = logging.getLogger(__name__)

# Closed set. A new in-app form adds one name here and passes it as `kind`.
TICKET_KINDS = frozenset({"problem", "support", "help", "info", "billing", "feature"})


def ticket_subject(kind: str, subject: str) -> str:
    return f"[{kind}] {subject}"


def smtp_ready() -> bool:
    return bool(os.getenv("SMTP_HOST", "").strip())


def _deliver(mail: EmailMessage) -> bool:
    host = os.getenv("SMTP_HOST", "").strip()
    if not host:
        return False
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=15) as smtp:
            if user:
                smtp.login(user, password)
            smtp.send_message(mail)
    else:
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.ehlo()
            if port == 587:
                smtp.starttls()
                smtp.ehlo()
            if user:
                smtp.login(user, password)
            smtp.send_message(mail)
    return True


def send_transactional(to: str, subject: str, body: str) -> bool:
    """Mail the account holder. Does not use the support ticket subject tag."""
    sender = os.getenv("SMTP_FROM", "").strip() or os.getenv("SUPPORT_INBOX", "").strip()
    if not smtp_ready() or not sender or "@" not in to:
        return False
    mail = EmailMessage()
    mail["Subject"] = subject
    mail["From"] = sender
    mail["To"] = to
    mail.set_content(body)
    try:
        return _deliver(mail)
    except (OSError, smtplib.SMTPException):
        logger.warning("Transactional email failed", exc_info=True)
        return False


def send_support_email(*, reply_to: str, subject: str, message: str, ticket_id: int) -> bool:
    host = os.getenv("SMTP_HOST", "").strip()
    inbox = os.getenv("SUPPORT_INBOX", "").strip()
    if not host or not inbox:
        logger.warning("Support ticket %s saved; SMTP_HOST or SUPPORT_INBOX is unset", ticket_id)
        return False
    sender = os.getenv("SMTP_FROM", "").strip() or inbox
    mail = EmailMessage()
    mail["Subject"] = subject
    mail["From"] = sender
    mail["To"] = inbox
    mail["Reply-To"] = reply_to
    mail.set_content(f"Ticket {ticket_id}\nReply to: {reply_to}\n\n{message}")
    try:
        return _deliver(mail)
    except (OSError, smtplib.SMTPException):
        logger.warning("Support ticket %s saved; email to the inbox failed", ticket_id, exc_info=True)
        return False
