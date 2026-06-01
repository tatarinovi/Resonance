import boto3
import uuid
import os
import json
import logging
from botocore.exceptions import ClientError
from .config import get_settings

settings = get_settings()
logger = logging.getLogger("matrix-hub.storage")

class S3Storage:
    def __init__(self):
        self.s3 = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
        )
        self.bucket = settings.s3_bucket

    def _ensure_bucket(self):
        # 1. Check if bucket exists, create if not
        try:
            self.s3.head_bucket(Bucket=self.bucket)
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code")
            if error_code == "404":
                try:
                    self.s3.create_bucket(Bucket=self.bucket)
                    logger.info(f"Storage: Created bucket {self.bucket}")
                except Exception as ex:
                    logger.error(f"Storage: Failed to create bucket: {ex}")
                    return
            else:
                logger.error(f"Storage: Failed to head bucket: {e}")
                return

        # 2. Always ensure public read policy is set
        try:
            policy = {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid": "PublicRead",
                        "Effect": "Allow",
                        "Principal": "*",
                        "Action": ["s3:GetObject"],
                        "Resource": [f"arn:aws:s3:::{self.bucket}/*"]
                    }
                ]
            }
            self.s3.put_bucket_policy(Bucket=self.bucket, Policy=json.dumps(policy))
        except Exception as e:
            # We log but don't fail, as some setups might not allow policy updates
            logger.warning(f"Storage: Could not set bucket policy (might be already set or limited permissions): {e}")

    def upload_file(self, content: bytes, filename: str, content_type: str) -> str:
        """
        Uploads a file and returns its public URL.
        """
        self._ensure_bucket()
        file_extension = os.path.splitext(filename)[1]
        unique_name = f"{uuid.uuid4()}{file_extension}"
        
        self.s3.put_object(
            Bucket=self.bucket,
            Key=unique_name,
            Body=content,
            ContentType=content_type
        )
        
        return f"{settings.s3_public_url}/{unique_name}"

    def delete_file(self, url: str):
        """
        Deletes a file based on its URL.
        """
        if not url.startswith(settings.s3_public_url):
            return
            
        filename = url.split("/")[-1]
        try:
            self.s3.delete_object(Bucket=self.bucket, Key=filename)
        except Exception as e:
            logger.error(f"Failed to delete file {filename}: {e}", exc_info=True)

    def list_objects(self):
        """Lists all files in the bucket."""
        response = self.s3.list_objects_v2(Bucket=self.bucket)
        return [obj["Key"] for obj in response.get("Contents", [])]

storage = S3Storage()
